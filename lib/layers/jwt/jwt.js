const NodeRSA = require('node-rsa');
const crypto = require('crypto');

class JWTManager {
  constructor() {
    this.keyPair = null;
    this.keyId = process.env.JWT_KEY_ID || 'bcscencryption';
  }

  initializeKeys() {
    if (!this.keyPair) {
      console.log('Initializing JWT keys...');
      
      // HARDCODED TEST KEYS FOR DEV
      const HARDCODED_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA2Z8uYhT4J9Q3K8H6gQ+k5X5Y7X8Y9Q3K8H6gQ+k5X5Y7X8Y
9Q3K8H6gQ+k5X5YaaaaaaBBBBB1111122222aaaaaaBBBBB1111122222aaaaaaBB
BBB1111122222aaaaaaBBBBB1111122222aaaaaaBBBBB1111122222aaaaaaBBBBB
1111122222aaaaaaBBBBB1111122222aaaaaaBBBBB1111122222aaaaaaBBBBB111
1122222aaaaaaBBBBB1111122222aaaaaaBBBBB1111122222aaaaaaBBBBB1111122
222aaaaaaBBBBB1111122222aaaaaaBBBBB1111122222aaaaaaBBBBB1111122222
aaaaaaBBBBB1111122222aaaaaaBBBBB1111122222aaaaaaBBBBB1111122222aaa
aaaBBBBB1111122222aaaaaaBBBBB1111122222aaaaaaBBBBB1111122222aaaaaB
BBBB1111122222aaaaaaBBBBB1111122222aaaaaaBBBBB1111122222aaaaaaBBBB
B1111122222aaaaaaBBBBB1111122222aaaaaaBBBBB1111122222aaaaaaBBBBB111
1122222aaaaaaBBBBB1111122222aaaaaaBBBBB1111122222aaaaaaBBBBB1111122
222aaaaaaBBBBB1111122222QIDAQAB
-----END RSA PRIVATE KEY-----`;

      const HARDCODED_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2Z8uYhT4J9Q3K8H6gQ+k
5X5Y7X8Y9Q3K8H6gQ+k5X5Y7X8Y9Q3K8H6gQ+k5X5Yaaaaaaa1111122222BBBBBB
aaaaaaa1111122222BBBBBBaaaaaaa1111122222BBBBBBaaaaaaa1111122222BBB
BBBaaaaaaa1111122222BBBBBBaaaaaaa1111122222BBBBBBaaaaaaa1111122222
BBBBBBaaaaaaa1111122222BBBBBBaaaaaaa1111122222BBBBBBaaaaaaa11111222
22BBBBBBaaaaaaa1111122222BBBBBBaaaaaaa1111122222BBBBBBaaaaaaa1111122
222BBBBBBaaaaaaa1111122222BBBBBBaaaaaaa1111122222BBBBBBaaaaaaa111112
2222BBBBBBaaaaaaa1111122222BBBBBBaaaaaaa1111122222BBBBBBaaaaaaa11111
22222BBBBBBaaaaaaa1111122222BBBBBBaaaaaaa1111122222BBBBBBaaaaaaa1111
122222BBBBBBaaaaaaa1111122222BBBBBBaaaaaaa1111122222QIDAQAB
-----END PUBLIC KEY-----`;

      console.log('USING HARDCODED TEST KEYS FOR DEV TESTING');
      
      this.keyPair = {
        private: HARDCODED_PRIVATE_KEY,
        public: HARDCODED_PUBLIC_KEY
      };
      
      console.log('JWT keys initialized with Key ID:', this.keyId);
      console.log('Test keys loaded - consistent across all Lambda invocations');
    }
  }

  generateJWKS() {
    this.initializeKeys();
    
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
      const headerObj = JSON.parse(base64urlDecode(header).toString());
      console.log('JWE Header:', headerObj);
      
      console.log('Decrypting CEK with RSA private key...');
      const encryptedKeyBuffer = base64urlDecode(encryptedKey);
      console.log('Encrypted key buffer length:', encryptedKeyBuffer.length);
      
      const rsaKey = new NodeRSA(this.keyPair.private);
      rsaKey.setOptions({ 
        encryptionScheme: 'oaep',
        mgf: 'mgf1',
        hashAlgorithm: 'sha256' 
      });
      
      const cek = rsaKey.decrypt(encryptedKeyBuffer);
      console.log('CEK decrypted successfully, length:', cek.length);
      
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
        
        // Use only the AES key portion (last 32 bytes)
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
      console.error('Error during decryption (probably incorrect key). Original error:', decryptError);
      throw new Error(`Error during decryption (probably incorrect key). Original error: ${decryptError.message}`);
    }
  }

  getPrivateKey() {
    this.initializeKeys();
    return this.keyPair.private;
  }
}

module.exports = { JWTManager };