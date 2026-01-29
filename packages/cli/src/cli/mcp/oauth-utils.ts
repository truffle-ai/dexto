import { createServer } from 'node:http';

export async function ensurePortAvailable(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const server = createServer();
        server.listen(port, () => {
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
