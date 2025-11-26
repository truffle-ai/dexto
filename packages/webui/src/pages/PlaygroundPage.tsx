import { Helmet } from 'react-helmet-async';
import PlaygroundView from '@/components/Playground/PlaygroundView';

export function PlaygroundPage() {
    return (
        <>
            <Helmet>
                <title>Playground · Dexto</title>
                <meta name="description" content="Test MCP tools in an interactive playground" />
            </Helmet>
            <PlaygroundView />
        </>
    );
}
