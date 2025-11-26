import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Home } from 'lucide-react';

export function NotFoundPage() {
    return (
        <div className="flex h-screen items-center justify-center bg-background">
            <div className="text-center space-y-6">
                <h1 className="text-6xl font-bold text-foreground">404</h1>
                <p className="text-xl text-muted-foreground">Page not found</p>
                <Link to="/">
                    <Button variant="default" className="gap-2">
                        <Home className="h-4 w-4" />
                        Return Home
                    </Button>
                </Link>
            </div>
        </div>
    );
}
