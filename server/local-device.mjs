import {VirtualDeviceAdapter} from './virtual-device.mjs';

/**
 * Base adapter of the REAL profile — no simulator process (2차 피드백 #2: 가상머신 삭제).
 *
 * RealCameraAdapter drives scanner 1's jobs itself and only needs a device record to copy
 * link / door / environment fields from. This adapter holds that record in-process:
 * - temperature / humidity come from a sensor reader when one is configured, otherwise they
 *   stay null ("unknown") — nothing is simulated.
 * - pcConnected is true until a PC link exists; doorOpen is false until a door sensor exists.
 * - jobs are never started here (the real adapter owns them), so tick() only keeps time.
 */
export class LocalBaseAdapter extends VirtualDeviceAdapter {
 constructor({config=[],sensor=null}={}){
  super({stageMs:1600,config});
  this.sensor=sensor;	// optional: async () => ({temperature, humidity})
  for(const d of this.devices){d.temperature=null;d.humidity=null;delete d.co2;delete d.targetCo2;d.pcConnected=true;}
  this.engineConnected=true;
  this.lastRead=0;
 }
 tick(ms){
  // no environment simulation; read the sensor at most every 10 s
  if(this.sensor&&Date.now()-this.lastRead>10000){
   this.lastRead=Date.now();
   Promise.resolve().then(()=>this.sensor()).then(v=>{for(const d of this.devices){if(Number.isFinite(v?.temperature))d.temperature=v.temperature;if(Number.isFinite(v?.humidity))d.humidity=v.humidity;}this.emit('change');}).catch(()=>{});
  }
  for(const d of this.devices){const j=d.job;if(j&&j.status==='running')j.elapsed+=ms;}
 }
 environment(args){for(const d of this.devices)d.targetTemperature=args.temperature;return Promise.resolve({accepted:true});}
}
