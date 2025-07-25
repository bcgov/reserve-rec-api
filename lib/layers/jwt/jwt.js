const NodeRSA = require('node-rsa');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class JWTManager {
  constructor() {
    this.keyPair = null;
    this.keyId = null;
  }

  initializeKeys() {
    if (!this.keyPair) {
      console.log('Initializing JWT keys...');
      
      // Generate RSA key pair
      const key = new NodeRSA({ b: 2048 });
      key.setOptions({ encryptionScheme: 'pkcs1' });
      
      this.keyPair = {
        private: key.exportKey('private'),
        public: key.exportKey('public'),
        components: key.exportKey('components-public')
      };
      
      this.keyId = process.env.JWT_KEY_ID || 'bcscencryption';
      
      console.log('JWT keys initialized');
    }
  }

  // Helper function to convert buffer to base64url
  bufferToBase64url(input) {
    let buffer;
    
    // Handle different input types
    if (Buffer.isBuffer(input)) {
      buffer = input;
    } else if (typeof input === 'string') {
      buffer = Buffer.from(input, 'base64');
    } else if (input instanceof Uint8Array) {
      buffer = Buffer.from(input);
    } else {
      // If it's a number or other type, convert to buffer
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
    
    console.log('Key components type:', typeof this.keyPair.components.n, typeof this.keyPair.components.e);
    console.log('Key components:', this.keyPair.components);
    
    // Convert RSA components to base64url properly
    const n = this.bufferToBase64url(this.keyPair.components.n);
    const e = this.bufferToBase64url(this.keyPair.components.e);
    
    const jwksKey = {
      alg: 'RS256',
      e: e,
      kid: this.keyId,
      kty: 'RSA',
      n: n,
      use: 'enc'
    };
    
    return {
      keys: [jwksKey]
    };
  }

  decryptJWE(jweToken) {
    this.initializeKeys();
    
    const parts = jweToken.split('.');
    if (parts.length !== 5) {
      throw new Error('Invalid JWE format - expected 5 parts');
    }
    
    const [header, encryptedKey, iv, ciphertext, tag] = parts;
    
    // Helper function to decode
    const base64urlDecode = (input) => {
      let padded = input;
      while (padded.length % 4) {
        padded += '=';
      }
      const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(base64, 'base64');
    };
    
    // Decrypt using our private key
    const encryptedKeyBuffer = base64urlDecode(encryptedKey);
    const key = new NodeRSA(this.keyPair.private);
    const cek = key.decrypt(encryptedKeyBuffer);
    
    // Decrypt the payload
    const headerObj = JSON.parse(base64urlDecode(header).toString());
    
    if (headerObj.enc === 'A256GCM') {
      const decipher = crypto.createDecipherGCM('aes-256-gcm', cek);
      decipher.setIV(base64urlDecode(iv));
      decipher.setAuthTag(base64urlDecode(tag));
      
      let decrypted = decipher.update(base64urlDecode(ciphertext), null, 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } else {
      throw new Error(`Unsupported JWE encryption algorithm: ${headerObj.enc}`);
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