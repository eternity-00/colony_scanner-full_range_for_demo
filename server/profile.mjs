// Deployment profile: which hardware this app runs on and how the tray is laid out.
//
// One value, COLONY_PROFILE=testbed|production (default testbed), picks profiles/<name>.json.
// Everything that used to be hard-coded (scanner count, 8 tiers x 3 columns, recipe file,
// camera device, ports, kiosk scale, feature switches) comes from there. Environment variables
// keep working as per-field overrides so the systemd unit can still pin a camera path.
import {readFileSync, existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const DEFAULTS = {
 name: 'testbed',
 title: '테스트베드',
 adapter: 'real',               // 'real' = scanner 1 on local USB camera + UART MCB, 'virtual' = simulator only
 scanners: 1,
 layout: {tiers: 8, columns: 3, tierShared: false}, // tray: plates per tier = columns; slot = (tiers - tier) * columns + col.
                                                     // tierShared: the columns of a tier are ONE physical plate (test jig) — any of the three cells means that tier
 recipe: 'config/mcb-config.testbed.json',
 dataDir: 'data/testbed',
 camera: {device: null, format: 'YUYV', width: 3840, height: 3040},
 mcb: {port: '/dev/serial0', firmwareMin: 18, expected: {}},
 alignment: {enabled: true},
 autoRun: false,                 // first start only; the operator's choice is persisted in state.json
 routine: {cycleHours: 12, days: 42, delay: 0, wellShots: 1},
 features: {triggers: false, simAlarm: false, demoPlates: false},
 network: {host: '127.0.0.1', port: 8787, enginePort: 8790, consolePort: 8792, adminPort: 8799},
 kiosk: {scale: 1.0, width: 1024, height: 600},
 limits: {captureZMax: 1000},
};

const merge = (a, b) => {
 const out = {...a};
 for (const [k, v] of Object.entries(b || {}))
  out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
 return out;
};

export function profileName() {
 return (process.env.COLONY_PROFILE || 'testbed').trim();
}

export function loadProfile(name = profileName()) {
 if (!/^[a-z0-9_-]+$/i.test(name)) throw Error(`COLONY_PROFILE 이름이 올바르지 않습니다: ${name}`);
 const file = join(ROOT, 'profiles', `${name}.json`);
 if (!existsSync(file)) throw Error(`프로필 파일이 없습니다: ${file}`);
 const p = merge(DEFAULTS, JSON.parse(readFileSync(file, 'utf8')));
 p.name = name;
 const {tiers, columns} = p.layout;
 if (!Number.isInteger(tiers) || tiers < 1 || tiers > 32 || !Number.isInteger(columns) || columns < 1 || columns > 6)
  throw Error(`프로필 layout 이 올바르지 않습니다 (tiers 1~32, columns 1~6): ${JSON.stringify(p.layout)}`);
 p.layout.slots = tiers * columns;
 p.layout.tierShared = !!p.layout.tierShared;
 p.layout.capacity = p.layout.tierShared ? tiers : p.layout.slots;
 // environment overrides (systemd unit / shell)
 if (process.env.COLONY_CAMERA_DEVICE) p.camera.device = process.env.COLONY_CAMERA_DEVICE;
 if (process.env.COLONY_MCB_PORT) p.mcb.port = process.env.COLONY_MCB_PORT;
 if (process.env.COLONY_DATA_DIR) p.dataDir = process.env.COLONY_DATA_DIR;
 if (process.env.COLONY_RECIPE) p.recipe = process.env.COLONY_RECIPE;
 if (process.env.PORT) p.network.port = Number(process.env.PORT);
 if (process.env.HOST) p.network.host = process.env.HOST;
 if (process.env.COLONY_TRIGGERS === '1') p.features.triggers = true;
 if (process.env.COLONY_CAMERA_ENABLED === '0') p.adapter = 'virtual';
 p.recipeFile = resolve(ROOT, p.recipe);
 p.dataDirAbs = resolve(ROOT, p.dataDir);
 p.file = file;
 return p;
}

/** The part of the profile the UI needs (sent in every state snapshot). */
export function publicProfile(p) {
 return {name: p.name, title: p.title, adapter: p.adapter, layout: p.layout, features: p.features, kiosk: p.kiosk, recipe: p.recipe};
}

/** slot (1..slots) -> {tier, col}; tier 1 is the bottom row, slot 1 is the top-left cell. */
export const slotCoord = (layout, slot) => ({
 tier: layout.tiers - Math.floor((slot - 1) / layout.columns),
 col: ((slot - 1) % layout.columns) + 1,
});
