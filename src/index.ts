import { Elysia } from "elysia";
import { slikRoutes } from "./routes/slik";

const app = new Elysia()
  // Manual CORS middleware configuration to prevent dependency bloating
  .onRequest(({ set }) => {
    set.headers['Access-Control-Allow-Origin'] = '*';
    set.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    set.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
  })
  .options('/*', ({ set }) => {
    set.headers['Access-Control-Allow-Origin'] = '*';
    set.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    set.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    return '';
  })
  .get("/", () => ({
    status: "ok",
    message: "SLIK OJK PDF Parser API is running",
    endpoints: {
      upload: "POST /api/slik/upload"
    }
  }))
  .use(slikRoutes)
  .listen(3000);

console.log(
  `🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`
);
