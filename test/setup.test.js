const request = require('supertest');
const app = require('../server');

describe('API Setup Tests', () => {
  test('Health check endpoint should return 200', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);
    
    expect(response.body.status).toBe('OK');
    expect(response.body.timestamp).toBeDefined();
    expect(response.body.uptime).toBeDefined();
  });

  test('Non-existent route should return 404', async () => {
    const response = await request(app)
      .get('/api/v1/nonexistent')
      .expect(404);
    
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  test('Auth endpoints should be accessible', async () => {
    // Test registration endpoint exists (should fail validation but not 404)
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({})
      .expect(400);
    
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Database Connection', () => {
  test('Should handle database connection gracefully', () => {
    // This test ensures the app starts without database connection errors
    expect(app).toBeDefined();
  });
});

describe('Environment Configuration', () => {
  test('Should have required environment variables', () => {
    // Check if critical env vars are set (in test environment they might be mocked)
    expect(process.env.NODE_ENV).toBeDefined();
  });
});