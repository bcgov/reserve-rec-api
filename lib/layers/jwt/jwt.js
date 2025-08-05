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
      
      // "REAL" TEST KEYS FOR DEV (from successful test)
      const HARDCODED_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAt/rluq6dn2NgK4ZPujW4ZD+eHNWoHvJ9FusrjUF5ovyr1BYF
sEZMKVaUw00xMBKeAH4T0qFz4IZlYXaQglmfLTQbpu7NxbBFBs/VTxzQw8AdWWPE
iceOoaoGjXgiY/JfxUpUdRC11KH/YkdZyyZVSamqmDxP9tiSqlW0vRkDLczKmJ4f
l718v0eJtCfBpiM9moo9l0x0351iEhtlJn5MzgvZsbG0XDP19KI4KV9oTy+1mCXW
xhb1+F9YENRARrZbKFpNHZqHZewbibGBoXsHUU9YJXZHp2EmyEt0NhLnEOz/RUC5
UKGqKVmZpMbRYdQ7Iz4UxvMJ3GNUU4LEFgzjjwIDAQABAoIBABcJVWaQoq/oc4w/
nxAD1fjHdnbJ0ek+F6ec/rELN73OwX0m3MN7qeGrM6lYqwYH7rzFDJpdGPNOILeZ
bvLDYgj481VtpVpRffMiZuUnCITaM1KUCXHvCM75SSTBnBzDpnY/nl+iHgJn3mBh
6r5jKF623eN9+c1AxOyLGrxqu1kqiv2u4s0986c7yKTZazEB+T7T52hSzpCVuArA
WAcOc6M9qQ2DlIc+GDKS3MtYw/bVrVwF6mRH2HUE6PrQVMjg+OLjSlr6z4Fh4RMa
E+jV/0VZAjKy0oLLD2RyHRu5KIwYHjOVrvnllGsIkdgAeeuN3rOuL2rqUo9UdK7m
eShl1TECgYEA3sI4MCQOYUSnEA0mtj7tEuGTey8ECSGi0J5n5TmACBJgDD23Il4/
m0cz075ZTPJN3R2wxVYDxIBoP68nP2Ov9q6yU6LW6qQZDPMrq+Eg+lAknZ7gpvR+
Lqem4X/h3hDKbkNoVX9GRTrKR4B2fUm9PdQCvGjtGo2/iLM3DE7Ig/MCgYEA029E
Cmber4BidcOkA8ci4SK/SMurOWjdiSOTd7ViwzbLjTawUiNPB3x7U9CdLseWCBgF
7r2vV0CEao/uR4pvGIv+iamF0+gnNh1hnYGmOtJc+C30PaFOF8a/2lgoCsVW97dJ
7aho3IVVdHC8VXc/Cb1kDcXalnhJcwwzQgPR9PUCgYEAtK0LLeDQ2Qv6BQbls0Pu
vjXAjVVhDJb/m/4ffsjYk7Nzu/oCpBmVtbhWzRPDEqolhYcjbauKesM7ywuh5cRR
YN/pO/UEJGTc/KfvcAW13dFLIZ1P0ZrVDbplnNlAtgEgb7a01UPaFyTMFJqZgJ1i
pNdlMLRaPANkqtfRemYcNQkCgYBJ5VRZclSX7/35fLQBIgMdvmAuWAhy2yS6PnXW
2801vxvrMdb0DiUbz7TmuT2GUPktwP+pzh/PFdxxxfYYiNiFMsB2aoo8YqH5ttEc
FGj9m/IkRyNautqpUqxQ6oisIwZfM28iIb7se6k/NfuMv02H4OpsKd9YwZeiHvx3
MRCbVQKBgQCTLVTZfKgU7MlvodEYYx8Jwgnz1XtcGZUaw4H6UB9+RNmA/rqTU4yU
FjKhJzOkTTMucLdRnI40tSa2GpH6Z41Ygexj/M1W0mR6Wbk6nmxYE3EjTjZlUOaU
QXTS5w/uzF5yWr2oA9rCRwX9gQANMSpj1qgcAMragT1r613UN8cmew==
-----END RSA PRIVATE KEY-----`;

      const HARDCODED_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt/rluq6dn2NgK4ZPujW4
ZD+eHNWoHvJ9FusrjUF5ovyr1BYFsEZMKVaUw00xMBKeAH4T0qFz4IZlYXaQglmf
LTQbpu7NxbBFBs/VTxzQw8AdWWPEiceOoaoGjXgiY/JfxUpUdRC11KH/YkdZyyZV
SamqmDxP9tiSqlW0vRkDLczKmJ4fl718v0eJtCfBpiM9moo9l0x0351iEhtlJn5M
zgvZsbG0XDP19KI4KV9oTy+1mCXWxhb1+F9YENRARrZbKFpNHZqHZewbibGBoXsH
UU9YJXZHp2EmyEt0NhLnEOz/RUC5UKGqKVmZpMbRYdQ7Iz4UxvMJ3GNUU4LEFgzj
jwIDAQAB
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
      

      const cek = crypto.privateDecrypt({
        key: this.keyPair.private,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
      }, encryptedKeyBuffer);
      
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