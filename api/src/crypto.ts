import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  createHash,
  timingSafeEqual,
  createHmac,
} from 'node:crypto';
import { AppError } from './errors.js';
export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
export class Vault {
  constructor(private master: Buffer) {
    if (master.length !== 32) throw new Error('Encryption key must be 32 bytes');
  }
  private key(scope: string): Buffer {
    return Buffer.from(
      hkdfSync('sha256', this.master, Buffer.from('travel-reliability-v1'), Buffer.from(scope), 32),
    );
  }
  seal(scope: string, plaintext: Buffer): Buffer {
    const nonce = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key(scope), nonce);
    cipher.setAAD(Buffer.from(scope));
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([Buffer.from('TRL1'), nonce, cipher.getAuthTag(), data]);
  }
  open(scope: string, sealed: Buffer): Buffer {
    try {
      if (sealed.length < 32 || sealed.subarray(0, 4).toString() !== 'TRL1') throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.key(scope), sealed.subarray(4, 16), {
        authTagLength: 16,
      });
      decipher.setAAD(Buffer.from(scope));
      decipher.setAuthTag(sealed.subarray(16, 32));
      return Buffer.concat([decipher.update(sealed.subarray(32)), decipher.final()]);
    } catch {
      throw new AppError('INTEGRITY_CHECK_FAILED', 409);
    }
  }
  opaque(value: string) {
    return createHmac('sha256', this.key('identity')).update(value).digest('hex');
  }
}
export function constantEqual(a: string, b: string): boolean {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
