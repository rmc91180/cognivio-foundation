import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

describe('Auth Utils', () => {
  const JWT_SECRET = 'test-jwt-secret';

  describe('Password Hashing', () => {
    it('hashes password correctly', async () => {
      const password = 'TestPassword123!';
      const hash = await bcrypt.hash(password, 10);

      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(50);
    });

    it('verifies correct password', async () => {
      const password = 'TestPassword123!';
      const hash = await bcrypt.hash(password, 10);

      const isValid = await bcrypt.compare(password, hash);
      expect(isValid).toBe(true);
    });

    it('rejects incorrect password', async () => {
      const password = 'TestPassword123!';
      const hash = await bcrypt.hash(password, 10);

      const isValid = await bcrypt.compare('WrongPassword', hash);
      expect(isValid).toBe(false);
    });
  });

  describe('JWT Tokens', () => {
    const testPayload = {
      userId: 'test-user-id',
      email: 'test@example.com',
      roles: ['admin'],
    };

    it('generates valid JWT token', () => {
      const token = jwt.sign(testPayload, JWT_SECRET, { expiresIn: '24h' });

      expect(token).toBeDefined();
      expect(token.split('.').length).toBe(3);
    });

    it('verifies and decodes token correctly', () => {
      const token = jwt.sign(testPayload, JWT_SECRET, { expiresIn: '24h' });
      const decoded = jwt.verify(token, JWT_SECRET) as typeof testPayload;

      expect(decoded.userId).toBe(testPayload.userId);
      expect(decoded.email).toBe(testPayload.email);
      expect(decoded.roles).toEqual(testPayload.roles);
    });

    it('rejects token with wrong secret', () => {
      const token = jwt.sign(testPayload, JWT_SECRET, { expiresIn: '24h' });

      expect(() => {
        jwt.verify(token, 'wrong-secret');
      }).toThrow();
    });

    it('rejects expired token', () => {
      const token = jwt.sign(testPayload, JWT_SECRET, { expiresIn: '-1s' });

      expect(() => {
        jwt.verify(token, JWT_SECRET);
      }).toThrow();
    });
  });
});
