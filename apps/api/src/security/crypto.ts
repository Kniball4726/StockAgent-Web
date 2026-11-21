import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  PASSWORD_ITERATIONS,
  PASSWORD_MIN_LENGTH,
} from "@stockagent/shared";

const SECRET_PREFIX = "enc:aes256gcm:";

export function validatePasswordPolicy(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(
      `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`
    );
  }
}

/**
 * Genera hash PBKDF2-HMAC-SHA256 con el mismo formato exacto que StockAgent Python
 * (`pbkdf2:sha256:600000$<salt_hex>$<digest_hex>`), usando la representación UTF-8 de la sal.
 */
export function hashPassword(password: string): string {
  validatePasswordPolicy(password);
  const salt = randomBytes(16).toString("hex");
  const derived = pbkdf2Sync(
    Buffer.from(password, "utf8"),
    Buffer.from(salt, "utf8"),
    PASSWORD_ITERATIONS,
    32,
    "sha256"
  ).toString("hex");
  return `pbkdf2:sha256:${PASSWORD_ITERATIONS}$${salt}$${derived}`;
}

/**
 * Verifica contraseñas contra hashes modernos (`$`) y heredados (`:`) en tiempo constante.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    if (!storedHash) {
      return false;
    }

    if (storedHash.includes(":") && !storedHash.includes("$")) {
      const sepIdx = storedHash.indexOf(":");
      const saltHex = storedHash.slice(0, sepIdx);
      const digestHex = storedHash.slice(sepIdx + 1);
      if (!saltHex || !digestHex) {
        return false;
      }
      const expected = Buffer.from(digestHex, "hex");
      const actual = pbkdf2Sync(
        Buffer.from(password, "utf8"),
        Buffer.from(saltHex, "hex"),
        PASSWORD_ITERATIONS,
        32,
        "sha256"
      );
      return (
        expected.length === actual.length && timingSafeEqual(actual, expected)
      );
    }

    const parts = storedHash.split("$");
    if (parts.length !== 3) {
      return false;
    }
    const [prefix, salt, expectedHex] = parts;
    if (!prefix || !salt || !expectedHex) {
      return false;
    }
    const iterStr = prefix.split(":").at(-1);
    const iterations = Number(iterStr);
    if (!Number.isInteger(iterations) || iterations <= 0) {
      return false;
    }

    const expected = Buffer.from(expectedHex, "hex");
    const actual = pbkdf2Sync(
      Buffer.from(password, "utf8"),
      Buffer.from(salt, "utf8"),
      iterations,
      expected.length,
      "sha256"
    );
    return (
      expected.length === actual.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}

export function hashSha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashToken(rawToken: string): string {
  return hashSha256(rawToken.trim());
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function generateApiKey(): { rawKey: string; keyHash: string } {
  const rawKey = `sk_live_${randomBytes(32).toString("base64url")}`;
  return { rawKey, keyHash: hashToken(rawKey) };
}

function resolveAesKey(masterKey?: string): Buffer {
  const raw =
    (masterKey ?? process.env.STOCKAGENT_ENCRYPTION_KEY ?? "").trim();
  if (!raw) {
    throw new Error(
      "STOCKAGENT_ENCRYPTION_KEY es obligatoria para cifrar/descifrar secretos."
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(SECRET_PREFIX);
}

export function encryptSecret(plaintext: string, masterKey?: string): string {
  if (!plaintext) {
    return "";
  }
  if (isEncryptedSecret(plaintext)) {
    return plaintext;
  }
  const key = resolveAesKey(masterKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${SECRET_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(value: string, masterKey?: string): string {
  if (!value) {
    return "";
  }
  if (!isEncryptedSecret(value)) {
    return value;
  }
  const payload = value.slice(SECRET_PREFIX.length);
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Formato de secreto cifrado inválido.");
  }
  const key = resolveAesKey(masterKey);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
