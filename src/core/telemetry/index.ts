import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { initializeMetrics } from './metrics.js';
import { type ValidatedAgentConfig } from '@core/agent/schemas.js';

import { logger } from '../logger/index.js';

export class TelemetryService {
    private sdk: NodeSDK | null = null;
    private readonly config: ValidatedAgentConfig['telemetry'];
    private readonly agentName: string;

    private metricReader: PrometheusExporter | undefined;

    constructor(config: ValidatedAgentConfig) {
        this.config = config.telemetry;
        this.agentName = config.agentCard?.name ?? 'dexto-agent';
    }

    public start() {
        if (!this.config.enabled) {
            logger.debug('Telemetry service is disabled in the configuration.');
            return;
        }

        const resource = resourceFromAttributes({
            [SemanticResourceAttributes.SERVICE_NAME]: this.agentName,
        });

        const traceExporter = this.config.jaeger.enabled
            ? new OTLPTraceExporter({
                  url: this.config.jaeger.endpoint,
              })
            : undefined;

        const metricReader = this.config.prometheus.enabled
            ? new PrometheusExporter({
                  port: this.config.prometheus.port,
              })
            : undefined;
        this.metricReader = metricReader;

        this.sdk = new NodeSDK({
            resource,
            traceExporter,
            metricReader,
            instrumentations: [getNodeAutoInstrumentations()],
        });

        this.sdk.start();
        initializeMetrics(); // Initialize metrics AFTER the SDK has started
        logger.info('Telemetry service started.');
        if (this.config.prometheus.enabled) {
            logger.info(
                `Prometheus metrics exporter listening on port ${this.config.prometheus.port}`
            );
        }
        if (this.config.jaeger.enabled) {
            logger.info(
                `Jaeger trace exporter configured for endpoint: ${this.config.jaeger.endpoint}`
            );
        }
    }

    public shutdown(): Promise<void> {
        if (!this.sdk) {
            return Promise.resolve();
        }
        logger.info('Shutting down telemetry service...');
        return this.sdk.shutdown().then(
            () => {
                logger.info('Telemetry service shut down successfully.');
            },
            (err) => {
                logger.error('Error shutting down telemetry service:', err);
            }
        );
    }
}
