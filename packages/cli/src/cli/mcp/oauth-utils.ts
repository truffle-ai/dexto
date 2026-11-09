import { createServer } from 'node:http';

export const LOOPBACK_HOST = '127.0.0.1';

export async function ensurePortAvailable(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const server = createServer();
        server.listen(port, LOOPBACK_HOST, () => {
            server.close(() => resolve());
        });
        server.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                reject(
                    new Error(
                        `Port ${port} is already in use. Please close the application using it and try again.`
                    )
                );
            } else {
                reject(err);
            }
        });
    });
}
