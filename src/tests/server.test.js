import request from 'supertest';
import app from '../../server';

describe('server.js unit testing', () => {
    test('POST / should return 400 if body missing', async () => {
        const response = await request(app).post('/').send({}).set('Content-Type', 'application/json');
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error');
    });

    test('GET /health should return ok', async () => {
        const response = await request(app).get('/health');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ status: 'ok' });
    });

    test('The response should be "Pong"', async () => {
        const response = await request(app).post('/').send({ msg: "Ping" }).set('Content-Type', 'application/json');;
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ msg: 'Pong' });
    });

    test('The response should throw an Error', async () => {
        const response = await request(app).post('/').send({ msg: "Pepe" }).set('Content-Type', 'application/json');;
        expect(response.status).toBe(400);
    });
});
