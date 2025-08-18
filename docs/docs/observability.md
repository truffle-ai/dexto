# Observability with OpenTelemetry

Dexto now includes built-in observability features powered by OpenTelemetry, allowing you to monitor your agent's performance, track requests, and debug issues with ease. This guide will walk you through setting up and using the observability stack.

## 1. Overview

Our observability stack leverages:
*   **OpenTelemetry:** For instrumenting the application to generate metrics, traces, and logs.
*   **Prometheus:** For collecting and storing metrics.
*   **Jaeger:** For collecting and visualizing distributed traces.
*   **Grafana:** For creating dashboards and visualizing metrics from Prometheus.

## 2. Enabling and Configuring Telemetry

Telemetry is configured via the `telemetry` section in your `agent.yml` file.

```yaml
telemetry:
  enabled: true # Set to true to enable telemetry
  prometheus:
    enabled: true # Enable Prometheus metrics exporter
    port: 9464    # Port for Prometheus exporter (accessible at http://localhost:9464/metrics)
  jaeger:
    enabled: true # Enable Jaeger trace exporter
    # Endpoint for Jaeger OTLP/HTTP collector.
    # Use http://localhost:4318/v1/traces if Dexto app is on host.
    # Use http://jaeger:4318/v1/traces if Dexto app is in Docker Compose.
    endpoint: http://localhost:4318/v1/traces
```

*   `enabled`: Master switch to enable or disable all telemetry.
*   `prometheus.enabled`: Enables the Prometheus metrics exporter.
*   `prometheus.port`: The port on which the Prometheus metrics will be exposed.
*   `jaeger.enabled`: Enables the Jaeger trace exporter.
*   `jaeger.endpoint`: The URL for the Jaeger OTLP/HTTP collector. **Ensure this matches your deployment environment.**

## 3. Running the Observability Stack (Docker Compose)

We provide a `docker-compose.yaml` file to easily spin up Prometheus, Jaeger, and Grafana.

1.  **Ensure your Dexto application is NOT running in Docker Compose.** This setup assumes Dexto runs on your host machine.
2.  **Start the observability services:**
    Open your terminal in the Dexto project root and run:
    ```bash
    docker-compose up --build
    ```
    This will start Prometheus, Jaeger, and Grafana.

### Accessing the UIs:

*   **Prometheus UI:** `http://localhost:9090`
*   **Jaeger UI:** `http://localhost:16686`
*   **Grafana UI:** `http://localhost:3002` (default login: `admin`/`admin`)

## 4. Metrics

Metrics provide numerical data about your application's performance and behavior.

### Collected Metrics:

*   **`dexto_api_requests_total`**: A counter for the total number of API requests received by the Dexto application.
    *   **Labels:**
        *   `method`: HTTP method (e.g., `GET`, `POST`).
        *   `route`: The matched Express route path (e.g., `/api/message`, `/health`).
        *   `status`: The HTTP status code of the response (e.g., `200`, `404`, `500`).
*   **Node.js Runtime Metrics**: OpenTelemetry automatically collects various Node.js runtime metrics (e.g., event loop utilization, garbage collection, memory usage).

### Accessing Metrics:

*   **Raw Metrics Endpoint:** Your Dexto application exposes its metrics at `http://localhost:9464/metrics`. You can view this directly in your browser.
*   **Prometheus UI:** You can query `dexto_api_requests_total` and other metrics directly in the Prometheus UI (`http://localhost:9090/graph`).

## 5. Tracing

Distributed tracing allows you to visualize the flow of a single request or operation as it propagates through different parts of your application.

### Generating Traces:

Traces are automatically generated when you interact with your Dexto application. For example:
*   Making an API call (e.g., `curl http://localhost:3001/health`, `curl -X POST http://localhost:3001/api/message -H "Content-Type: application/json" -d '{"message": "Hello"}'`).
*   Any internal operations like LLM calls or tool executions.

### Using Jaeger UI:

1.  Open the Jaeger UI: `http://localhost:16686`
2.  In the "Search" tab on the left:
    *   Select `dexto-agent` from the **Service** dropdown.
    *   Click **Find Traces**.
3.  **Explore Spans:** Click on any trace to see its detailed "flame graph". You will see spans for:
    *   `GET /health` or `POST /api/message` (from Express auto-instrumentation).
    *   `DextoAgent.run`: The main agent execution.
    *   `DextoAgent.executeTool`: When a tool is called.
    *   `DextoAgent.switchLLM`: When the LLM configuration is changed.
    *   `LLMService.completeTask`: The actual call to the LLM provider.

## 6. Log Correlation

Logs are automatically enriched with trace and span IDs, allowing you to correlate log messages with specific traces.

*   **Log File:** Your Dexto application logs are typically found at `.dexto/logs/dexto.log` (relative to your project root).
*   **Correlation:** When viewing logs, you will see `trace_id` and `span_id` fields in the JSON log entries. These IDs match the `traceID` and `spanID` in Jaeger, enabling you to jump from a log message directly to the corresponding trace.

## 7. Grafana Dashboards

Grafana is used to visualize the metrics collected by Prometheus.

### Accessing Grafana:

1.  Go to `http://localhost:3002`.
2.  Login with `admin`/`admin` (you might be prompted to change the password).

### Pre-provisioned Dashboard:

*   We've pre-provisioned a dashboard for you. Navigate to **Dashboards** (four squares icon on the left) -> **Browse**.
*   You should find the **"Dexto API Dashboard"**.
*   This dashboard includes an "API Request Rate" panel that visualizes the `dexto_api_requests_total` metric.

### Troubleshooting:

*   **"Connection refused" or "Failed to fetch" in Grafana:** Ensure your `docker-compose up --build` command completed successfully and all services are "Up" (`docker-compose ps`).
*   **Metrics not appearing in Prometheus/Grafana:**
    *   Ensure your Dexto application is running (`npm run start`).
    *   Verify you can access `http://localhost:9464/metrics` directly in your browser.
    *   Generate activity in your Dexto app to increment counters and create traces.
*   **Traces not appearing in Jaeger:**
    *   Ensure your Dexto application is running.
    *   Verify the `jaeger.endpoint` in `agent.yml` is `http://localhost:4318/v1/traces` (for host-based app) or `http://jaeger:4318/v1/traces` (for Docker-based app).
    *   Generate activity in your Dexto app.
    *   Check your Dexto app's terminal for any errors related to trace export.
