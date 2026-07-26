import mqtt, { type MqttClient } from 'mqtt';
import type { TelemetryEvent } from '@linelens/contracts';
import { topicFor } from '@linelens/contracts';
import type { Logger } from 'pino';

/**
 * MQTT publisher — mqtt@5 client config per STACK.md's broker-restart
 * survival notes: stable clientId, `clean: false`, QoS 1 publish. Handlers
 * are attached BEFORE connect (mqtt@5 gotcha).
 */
export interface Publisher {
  client: MqttClient;
  publish: (e: TelemetryEvent) => void;
  close: () => Promise<void>;
}

export interface CreatePublisherOptions {
  url: string;
  logger: Logger;
  clientId?: string;
}

export const createPublisher = ({ url, logger, clientId = 'linelens-simulator' }: CreatePublisherOptions): Promise<Publisher> =>
  new Promise((resolve, reject) => {
    const client = mqtt.connect(url, {
      clientId,
      clean: false,
      reconnectPeriod: 1000,
      connectTimeout: 30_000,
      manualConnect: true,
    });

    // Attach handlers BEFORE connect() — mqtt@5 gotcha.
    client.on('connect', () => {
      logger.info({ url, clientId }, 'mqtt publisher connected');
      resolve({
        client,
        publish: (e: TelemetryEvent) => {
          client.publish(topicFor(e), JSON.stringify(e), { qos: 1 }, (err) => {
            if (err) logger.error({ err, machineId: e.machineId, kind: e.kind }, 'mqtt publish failed');
          });
        },
        close: () =>
          new Promise<void>((res) => {
            client.end(false, {}, () => res());
          }),
      });
    });

    client.on('error', (err) => {
      logger.error({ err }, 'mqtt publisher error');
      reject(err);
    });

    client.on('reconnect', () => logger.warn('mqtt publisher reconnecting'));
    client.on('close', () => logger.warn('mqtt publisher connection closed'));

    client.connect();
  });
