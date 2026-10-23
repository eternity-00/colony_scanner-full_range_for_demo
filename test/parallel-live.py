"""Run the deployed preparation/return recipe and observe concurrent MOV flags.

Moves the real jig, takes no images and changes no plate history. Read JSON
{load, return, initial, axes} from stdin. The application must be stopped first.
"""
import importlib.util
import json
from pathlib import Path
import re
import sys

spec=importlib.util.spec_from_file_location('mcb',Path(__file__).parents[1]/'device/mcb.py')
mcb=importlib.util.module_from_spec(spec);spec.loader.exec_module(mcb)
recipe=json.load(sys.stdin)
for motor in recipe['initial'].values():
    if motor.get('MOV') or motor.get('FLT') or not motor.get('HOMED'):
        raise SystemExit('Initial motor state is not stationary, healthy and homed')
original_link=mcb.Link

def observed_link():
    link=original_link()
    original_write=link.ser.write
    def write(data):
        # Read an immediate status after starting the grouped MOVE lines.
        if data.startswith(b'MOVE ') and data.count(b'\n')>1:
            return original_write(data+b'STATUS\n')
        return original_write(data)
    link.ser.write=write
    return link

mcb.Link=observed_link
try:
    print('LIVE: loading with parallel Z/XY',flush=True)
    loaded=mcb.run({'steps':recipe['load'],'timeout':120})
    print('LIVE: preparation finished; returning to park',flush=True)
    returned=mcb.run({'steps':recipe['return'],'timeout':120})
except Exception:
    mcb.stop()
    raise
moving={}
for line in loaded['log']:
    match=re.match(r'^M([1-6]) ',line)
    if match:
        state=mcb.parse_kv(line)
        if state.get('MOV')==1:
            moving[match[1]]=state
expected={str(recipe['axes'][axis]) for axis in ['cameraX','cameraY','trayZ']}
assert expected.issubset(moving),f'Parallel movement was not observed: {moving}'
assert all(not motor.get('MOV') and not motor.get('FLT') for motor in returned['motors'].values())
assert all(returned['motors'][int(motor)]['POS']==initial['POS'] for motor,initial in recipe['initial'].items()),'final positions differ from the original parked positions'
print(json.dumps({'ok':True,'concurrentMovingAxes':sorted(expected),'observed':moving,'prepareSeconds':loaded['seconds'],'returnSeconds':returned['seconds'],'finalMotors':returned['motors'],'prepareLog':loaded['log']},ensure_ascii=False),flush=True)
