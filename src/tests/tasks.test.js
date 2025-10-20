import request from 'supertest';
import app, { resetTasks } from '../../server';

describe('tasks CRUD', () => {
    beforeEach(() => {
        resetTasks();
    });

    test('create -> get -> list -> update -> delete', async () => {
        // create
        const create = await request(app)
            .post('/tasks')
            .send({ title: 'Task 1', description: 'desc' })
            .set('Content-Type', 'application/json');
        expect(create.status).toBe(201);
        expect(create.body).toMatchObject({ id: expect.any(String), title: 'Task 1', description: 'desc' });
        const id = create.body.id;

        // get
        const get = await request(app).get(`/tasks/${id}`);
        expect(get.status).toBe(200);
        expect(get.body).toMatchObject({ id, title: 'Task 1', description: 'desc' });

        // list
        const list = await request(app).get('/tasks');
        expect(list.status).toBe(200);
        expect(list.body).toHaveLength(1);

        // update
        const update = await request(app)
            .put(`/tasks/${id}`)
            .send({ title: 'Task 1 updated' })
            .set('Content-Type', 'application/json');
        expect(update.status).toBe(200);
        expect(update.body).toMatchObject({ id, title: 'Task 1 updated', description: 'desc' });

        // delete
        const del = await request(app).delete(`/tasks/${id}`);
        expect(del.status).toBe(204);

        // get missing
        const missing = await request(app).get(`/tasks/${id}`);
        expect(missing.status).toBe(404);
    });

    test('validation errors', async () => {
        const badCreate = await request(app).post('/tasks').send({}).set('Content-Type', 'application/json');
        expect(badCreate.status).toBe(400);

        const create = await request(app).post('/tasks').send({ title: 'X' }).set('Content-Type', 'application/json');
        const id = create.body.id;

        const badUpdateTitle = await request(app)
            .put(`/tasks/${id}`)
            .send({ title: 123 })
            .set('Content-Type', 'application/json');
        expect(badUpdateTitle.status).toBe(400);

        const badUpdateDesc = await request(app)
            .put(`/tasks/${id}`)
            .send({ description: 123 })
            .set('Content-Type', 'application/json');
        expect(badUpdateDesc.status).toBe(400);
    });
});


