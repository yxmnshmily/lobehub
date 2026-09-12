import { FileS3 } from '@/server/modules/S3';
import { zstdDecompress } from 'node:zlib';
import { promisify } from 'node:util';
const decompress = promisify(zstdDecompress);
(async () => {
  const s3 = new FileS3();
  const key = 'agent-traces/agt_jPjdoH3ZNsuv/tpc_7REQKM88o7uP/op_1789017109468_agt_jPjdoH3ZNsuv_tpc_7REQKM88o7uP_cT7zEYCS.json.zst';
  try {
    const bytes = await s3.getFileByteArray(key);
    const buf = await decompress(Buffer.from(bytes));
    const snap = JSON.parse(buf.toString('utf8'));
    const s = JSON.stringify(snap);
    console.log('snap size:', s.length);
    console.log('has partial:', s.includes('partial'));
    console.log('has stream:', s.includes('stream'));
    const keys = Object.keys(snap);
    console.log('top keys:', keys.join(','));
    // find request payloads
    const steps = snap.steps ?? snap.executionSteps ?? [];
    console.log('steps:', Array.isArray(steps) ? steps.length : 'n/a');
    if (Array.isArray(steps)) {
      for (const st of steps.slice(0, 3)) {
        console.log('step keys:', Object.keys(st).join(','));
        const req = (st as any).request ?? (st as any).payload ?? (st as any).llm;
        if (req) console.log('  req snippet:', JSON.stringify(req).slice(0, 400));
      }
    }
  } catch (e:any) { console.error('ERR', e?.message ?? e); }
  process.exit(0);
})();
