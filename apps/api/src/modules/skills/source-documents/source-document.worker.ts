import { parseSourceInWorker } from './source-document.parser';
import { SkillError } from '../skills.types';

process.once('message', (value: { bytes: string; name: string }) => {
  try {
    const prototypeKeys = Object.getOwnPropertyNames(Object.prototype).join(',');
    const document = parseSourceInWorker({ bytes: Buffer.from(value.bytes, 'base64'), name: value.name, mime: '' });
    if (Object.getOwnPropertyNames(Object.prototype).join(',') !== prototypeKeys) throw new Error('Parser pollution');
    process.send?.({ ok: true, document });
  } catch (error) {
    process.send?.({ ok: false, large: error instanceof SkillError && error.code === 'SOURCE_DOCUMENT_TOO_LARGE' });
  }
});
