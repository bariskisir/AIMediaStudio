/**
 * Persists one provider API key with Electron's operating-system-backed encryption.
 */

import { readFile, unlink, writeFile } from 'node:fs/promises'
import { safeStorage } from 'electron'

export default class CredentialService {
  /** Creates a credential service for one encrypted file. */
  public constructor(private readonly filePath: string) {}

  /** Reports whether an encrypted credential can be decrypted on the current system. */
  public async hasApiKey(): Promise<boolean> {
    return Boolean(await this.getApiKey())
  }

  /** Decrypts the API key and rotates its ciphertext when required. */
  public async getApiKey(): Promise<string | null> {
    try {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) return null
      const encrypted = await readFile(this.filePath)
      const decrypted = await safeStorage.decryptStringAsync(encrypted)
      if (decrypted.shouldReEncrypt) await this.saveApiKey(decrypted.result)
      return decrypted.result
    } catch {
      return null
    }
  }

  /** Encrypts and saves an API key without allowing plaintext fallback. */
  public async saveApiKey(apiKey: string): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Secure credential storage is not available on this system.')
    }
    const encrypted = await safeStorage.encryptStringAsync(apiKey)
    await writeFile(this.filePath, encrypted, { mode: 0o600 })
  }

  /** Removes the encrypted API key if one exists. */
  public async deleteApiKey(): Promise<void> {
    try {
      await unlink(this.filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
