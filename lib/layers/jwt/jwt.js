const NodeRSA = require('node-rsa');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class JWTManager {
  constructor() {
    this.keyPair = null;
    this.keyId = process.env.JWT_KEY_ID || 'bcscencryption';
  }

  initializeKeys() {
    if (!this.keyPair) {
      console.log('Initializing JWT keys...');
      if (process.env.BCSC_PRIVATE_KEY && process.env.BCSC_PUBLIC_KEY) {
        console.log('Using persistent keys from environment variables');
        this.keyPair = {
          private: process.env.BCSC_PRIVATE_KEY.replace(/\\n/g, '\n'),
          public: process.env.BCSC_PUBLIC_KEY.replace(/\\n/g, '\n')
        };
      } else {
        console.log('No persistent keys found, generating new ones...');
        const key = new NodeRSA({ b: 2048 });
        key.setOptions({ 
          encryptionScheme: 'pkcs1_oaep'
        });
        
        this.keyPair = {
          private: key.exportKey('private'),
          public: key.exportKey('public')
        };
      }
      
      console.log('JWT keys initialized with Key ID:', this.keyId);
    }
  }
  bufferToBase64url(input) {
    let buffer;
    if (Buffer.isBuffer(input)) {
      buffer = input;
    } else if (typeof input === 'string') {
      buffer = Buffer.from(input, 'base64');
    } else if (input instanceof Uint8Array) {
      buffer = Buffer.from(input);
    } else {
      buffer = Buffer.from(input.toString(), 'base64');
    }
    
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  generateJWKS() {
    this.initializeKeys();
    
    const key = new NodeRSA(this.keyPair.public);
    const components = key.exportKey('components-public');
    
    const e = "AQAB";
    const n = Buffer.from(components.n)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    const jwksKey = {
      n: n,
      e: e,
      kty: "RSA",
      use: "enc",
      alg: "RS256",
      kid: this.keyId
    };
    
    return {
      keys: [jwksKey]
    };
  }

  decryptJWE(jweToken) {
    this.initializeKeys();
    
    console.log('Starting JWE decryption...');
    console.log('JWE token length:', jweToken.length);
    
    const parts = jweToken.split('.');
    if (parts.length !== 5) {
      throw new Error(`Invalid JWE format - expected 5 parts, got ${parts.length}`);
    }
    
    const [header, encryptedKey, iv, ciphertext, tag] = parts;
    console.log('JWE parts extracted successfully');
    
    // Helper function to decode base64url
    const base64urlDecode = (input) => {
      let padded = input;
      while (padded.length % 4) {
        padded += '=';
      }
      const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(base64, 'base64');
    };
    
    try {
      // Parse the header
      const headerObj = JSON.parse(base64urlDecode(header).toString());
      console.log('JWE Header:', headerObj);
      
      console.log('Decrypting CEK with RSA private key...');
      const encryptedKeyBuffer = base64urlDecode(encryptedKey);
      console.log('Encrypted key buffer length:', encryptedKeyBuffer.length);
      
      const rsaKey = new NodeRSA(this.keyPair.private);
      rsaKey.setOptions({ 
        encryptionScheme: 'pkcs1_oaep'
      });
      
      const cek = rsaKey.decrypt(encryptedKeyBuffer);
      console.log('CEK decrypted successfully, length:', cek.length);
      if (headerObj.enc !== 'A256GCM') {
        throw new Error(`Unsupported JWE encryption algorithm: ${headerObj.enc}. Expected A256GCM`);
      }
      
      console.log('Decrypting payload with AES-256-GCM...');
      const decipher = crypto.createDecipherGCM('aes-256-gcm', cek);
      decipher.setIV(base64urlDecode(iv));
      decipher.setAuthTag(base64urlDecode(tag));
      
      let decrypted = decipher.update(base64urlDecode(ciphertext), null, 'utf8');
      decrypted += decipher.final('utf8');
      
      console.log('JWE payload decrypted successfully');
      console.log('Decrypted payload length:', decrypted.length);
      
      return decrypted;
      
    } catch (decryptError) {
      console.error('JWE decryption failed:', decryptError.message);
      console.error('Error during decryption (probably incorrect key). Original error:', decryptError);
      throw new Error(`Error during decryption (probably incorrect key). Original error: ${decryptError.message}`);
    }
  }

  getPrivateKey() {
    this.initializeKeys();
    return this.keyPair.private;
  }
}

module.exports = {
  JWTManager,
  NodeRSA,
  jwt
};