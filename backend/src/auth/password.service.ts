import { randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash?: Promise<string>;

  async onModuleInit(): Promise<void> {
    await this.getDummyHash();
  }

  verify(encoded: string, password: string): Promise<boolean> {
    return verify(encoded, password);
  }

  async verifyForLogin(
    encoded: string | undefined,
    password: string,
  ): Promise<boolean> {
    return this.verify(encoded ?? (await this.getDummyHash()), password);
  }

  private getDummyHash(): Promise<string> {
    return (this.dummyHash ??= this.hash(randomBytes(32).toString('hex')));
  }

  hash(password: string): Promise<string> {
    return hash(password, {
      type: argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }
}
