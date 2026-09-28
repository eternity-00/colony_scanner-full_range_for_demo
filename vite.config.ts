import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
// 빌드 시각을 번들에 박는다. 파이에 여러 버전이 나란히 있어서, 화면만 보고는
// 어느 것이 도는지 알 수 없었다(v3 를 v4 로 착각한 일이 있었다).
const buildAt = new Date().toISOString();
export default defineConfig({plugins:[react()],define:{__BUILD_AT__:JSON.stringify(buildAt)},server:{host:'127.0.0.1',port:5173,proxy:{'/api':{target:'http://127.0.0.1:8787'}}},build:{target:'es2020'}});
