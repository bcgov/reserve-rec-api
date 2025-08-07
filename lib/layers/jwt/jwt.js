const NodeRSA = require('node-rsa');
const crypto = require('crypto');
const { KMSClient, DecryptCommand, GetPublicKeyCommand } = require('@aws-sdk/client-kms');

class JWTManager {
  constructor() {
    this.keyPair = null;
    this.keyId = process.env.JWT_KEY_ID || 'bcscencryption';
    this.bcscKeyId = process.env.BCSC_KEY_ID; 
    this.kmsClient = new KMSClient({ region: process.env.AWS_REGION || 'ca-central-1' });
  }

  async initializeKeys() {
    if (!this.keyPair) {
      console.log('Initializing JWT keys from KMS...');

      if (!this.bcscKeyId) {
        throw new Error('BCSC_KEY_ID environment variable not set');
      }
      
      try {
        console.log('Fetching public key from KMS...');
        
        // Get the public key from KMS
        const publicKeyResponse = await this.kmsClient.send(new GetPublicKeyCommand({
          KeyId: this.bcscKeyId
        }));
        
        // Convert DER format to PEM format
        const publicKeyDer = publicKeyResponse.PublicKey;
        const publicKeyPem = this.derToPem(publicKeyDer, 'PUBLIC KEY');
        
        console.log('Public key loaded from KMS');
        console.log('Key usage:', publicKeyResponse.KeyUsage);
        console.log('Key spec:', publicKeyResponse.KeySpec);
        console.log('Encryption algorithms:', publicKeyResponse.EncryptionAlgorithms);
        
        this.keyPair = {
          public: publicKeyPem,
          bcscKeyId: this.bcscKeyId
        };
        
        console.log('JWT keys initialized with Key ID:', this.keyId);
        
      } catch (error) {
        console.error('Failed to load keys from KMS:', error);
        throw new Error(`KMS key retrieval failed: ${error.message}`);
      }
    }
  }

  // aws gives you der, we need PEM format
  derToPem(der, type) {
    const base64 = Buffer.from(der).toString('base64');
    const pemBody = base64.match(/.{1,64}/g).join('\n');
    return `-----BEGIN ${type}-----\n${pemBody}\n-----END ${type}-----`;
  }

  async generateJWKS() {
    await this.initializeKeys();
    
    const key = new NodeRSA(this.keyPair.public);
    const components = key.exportKey('components-public');
    
    const jwksKey = {
      n: Buffer.from(components.n).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
      e: "AQAB",
      kty: "RSA",
      use: "enc",
      alg: "RS256",
      kid: this.keyId
    };
    
    return {
      keys: [jwksKey]
    };
  }

  async decryptJWE(jweToken) {
    await this.initializeKeys();
    
    console.log('Starting JWE decryption...');
    console.log('JWE token length:', jweToken.length);
    
    const parts = jweToken.split('.');
    if (parts.length !== 5) {
      throw new Error(`Invalid JWE format - expected 5 parts, got ${parts.length}`);
    }
    
    const [header, encryptedKey, iv, ciphertext, tag] = parts;
    console.log('JWE parts extracted successfully');
    
    const base64urlDecode = (input) => {
      let padded = input;
      while (padded.length % 4) {
        padded += '=';
      }
      const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(base64, 'base64');
    };
    
    try {
      const headerObj = JSON.parse(base64urlDecode(header).toString());
      console.log('JWE Header:', headerObj);
      
      console.log('Decrypting CEK with KMS...');
      const encryptedKeyBuffer = base64urlDecode(encryptedKey);
      console.log('Encrypted key buffer length:', encryptedKeyBuffer.length);
      
      //Use KMS to decrypt instead of local private key
      const kmsDecryptResponse = await this.kmsClient.send(new DecryptCommand({
        KeyId: this.bcscKeyId,
        CiphertextBlob: encryptedKeyBuffer,
        EncryptionAlgorithm: 'RSAES_OAEP_SHA_256' // Match your KMS key algorithm
      }));
      
      const cek = Buffer.from(kmsDecryptResponse.Plaintext);
      console.log('CEK decrypted successfully with KMS, length:', cek.length);
      
      let decrypted;
      
      if (headerObj.enc === 'A256GCM') {
        console.log('Decrypting payload with AES-256-GCM...');
        const decipher = crypto.createDecipherGCM('aes-256-gcm', cek);
        decipher.setIV(base64urlDecode(iv));
        decipher.setAuthTag(base64urlDecode(tag));
        
        decrypted = decipher.update(base64urlDecode(ciphertext), null, 'utf8');
        decrypted += decipher.final('utf8');
        
      } else if (headerObj.enc === 'A256CBC-HS512') {
        console.log('Decrypting payload with AES-256-CBC + HMAC-SHA512...');
        
        if (cek.length !== 64) {
          throw new Error(`Invalid CEK length for A256CBC-HS512: ${cek.length}, expected 64`);
        }
        const aesKey = cek.slice(32, 64);
        const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, base64urlDecode(iv));
        decrypted = decipher.update(base64urlDecode(ciphertext), null, 'utf8');
        decrypted += decipher.final('utf8');
        
      } else {
        throw new Error(`Unsupported JWE encryption algorithm: ${headerObj.enc}. Supported: A256GCM, A256CBC-HS512`);
      }
      
      console.log('JWE payload decrypted successfully');
      console.log('Decrypted payload length:', decrypted.length);
      
      return decrypted;
      
    } catch (decryptError) {
      console.error('JWE decryption failed:', decryptError.message);
      throw new Error(`Error during decryption: ${decryptError.message}`);
    }
  }

  async getPublicKey() {
    await this.initializeKeys();
    return this.keyPair.public;
  }
}

module.exports = { JWTManager };