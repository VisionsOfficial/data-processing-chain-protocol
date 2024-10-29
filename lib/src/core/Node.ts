import {
  DataType,
  ChainStatus,
  PipelineData,
  ProcessorPipeline,
  NodeType,
  NodeSignal,
  NodeConfig,
  ChainType,
  PipelineMeta,
} from '../types/types';
import { setTimeout, setImmediate } from 'timers';
import { randomUUID } from 'node:crypto';
import { Logger } from '../extra/Logger';
import { NodeSupervisor } from './NodeSupervisor';
import { MonitoringAgent, ReportingAgent } from '../agents/MonitoringAgent';

export class Node {
  private id: string;
  private pipelines: ProcessorPipeline[];
  // Todo:
  private dependencies: string[];
  private status: ChainStatus.Type;
  private error?: Error;
  private delay: number;
  private progress: number;
  private dataType: DataType.Type;
  private executionQueue: Promise<void>;
  private output: PipelineData[];
  private nextNodeInfo: {
    id: string;
    type: NodeType.Type;
    meta?: PipelineMeta;
  } | null;
  private config: NodeConfig | null;
  private reporting: ReportingAgent | null = null;

  constructor(dependencies: string[] = []) {
    this.id = randomUUID();
    this.output = [];
    this.pipelines = [];
    this.dependencies = dependencies;
    this.status = ChainStatus.NODE_PENDING;
    this.delay = 0;
    this.progress = 0;
    this.dataType = DataType.RAW;
    this.executionQueue = Promise.resolve();
    this.nextNodeInfo = null;
    this.config = null;
  }

  private updateProgress(): void {
    this.progress += 1 / this.pipelines.length;
  }

  setConfig(config: NodeConfig): void {
    const { chainId, index } = config;
    if (index !== undefined) {
      const monitoring = MonitoringAgent.retrieveService();
      this.reporting = monitoring.genReportingAgent({
        chainId,
        nodeId: this.id,
        index,
      });
    } else {
      Logger.warn('Node index is not defined, configuration failed');
    }
    this.config = config;
  }

  getExecutionQueue(): Promise<void> {
    return this.executionQueue;
  }
  getConfig(): NodeConfig | null {
    return this.config;
  }

  getId(): string {
    return this.id;
  }

  addPipeline(pipeline: ProcessorPipeline): void {
    this.pipelines.push(pipeline);
  }

  // digest the data through successive processing stages
  private async processPipeline(
    pipeline: ProcessorPipeline,
    data: PipelineData,
  ): Promise<PipelineData> {
    let result = data;
    for (const processor of pipeline) {
      result = await processor.digest(result);
    }
    return result;
  }

  private *getPipelineGenerator(
    pipelines: ProcessorPipeline[],
    count: number,
  ): Generator<ProcessorPipeline[], void, unknown> {
    for (let i = 0; i < pipelines.length; i += count) {
      yield pipelines.slice(i, i + count);
    }
  }

  notify(notify: ChainStatus.Type): void {
    try {
      if (this.reporting !== null) {
        this.reporting.notify(notify, 'global-signal');
      } else {
        throw new Error('Reporter not set');
      }
    } catch (error) {
      Logger.error((error as Error).message);
    }
  }

  async execute(data: PipelineData): Promise<void> {
    this.executionQueue = this.executionQueue.then(async () => {
      try {
        this.updateStatus(ChainStatus.NODE_IN_PROGRESS);
        // todo: monitor this step
        if (this.delay > 0) {
          await this.sleep(this.delay);
        }

        const generator = this.getPipelineGenerator(this.pipelines, 3);

        for (const pipelineBatch of generator) {
          await new Promise<void>((resolve, reject) => {
            setImmediate(async () => {
              try {
                const batchPromises = pipelineBatch.map((pipeline) =>
                  this.processPipeline(pipeline, data).then(
                    (pipelineData: PipelineData) => {
                      this.output.push(pipelineData);
                      this.updateProgress();
                      // todo: monitor this step
                    },
                  ),
                );
                await Promise.all(batchPromises);
                resolve();
              } catch (error) {
                reject(error);
              }
            });
          });
        }

        this.updateStatus(ChainStatus.NODE_COMPLETED);
      } catch (error) {
        this.updateStatus(ChainStatus.NODE_FAILED, error as Error);
        Logger.error(`Node ${this.id} execution failed: ${error}`);
      }
    });

    const supervisor = NodeSupervisor.retrieveService();
    await supervisor.handleRequest({
      signal: NodeSignal.NODE_SEND_DATA,
      id: this.id,
    });
  }

  // ...
  async sendData(): Promise<void> {
    // make sure the queue has finished
    await this.executionQueue;
    Logger.info(`Sending data from node ${this.id}.`);
    await Node.terminate(this.id, this.output);
  }

  private static async terminate(nodeId: string, pipelineData: PipelineData[]) {
    // todo: format data
    const data = pipelineData[0]; // tmp
    await Node.moveToNextNode(nodeId, data);
  }

  // todo: should not be static
  private static async moveToNextNode(
    nodeId: string,
    pipelineData: PipelineData,
  ) {
    const supervisor = NodeSupervisor.retrieveService();
    const nodes = supervisor.getNodes();
    const currentNode = nodes.get(nodeId);
    if (!currentNode) {
      Logger.warn(`Node ${nodeId} not found for moving to next node.`);
      return;
    }
    const nextNodeInfo = currentNode.getNextNodeInfo();
    if (nextNodeInfo) {
      if (nextNodeInfo.type === NodeType.LOCAL) {
        await supervisor.handleRequest({
          signal: NodeSignal.NODE_RUN,
          id: nextNodeInfo.id,
          data: pipelineData,
        });
      } else if (nextNodeInfo.type === NodeType.REMOTE) {
        supervisor.remoteServiceCallback({
          // targetId and meta are related to the next remote target service uid
          chainId: currentNode.getConfig()?.chainId,
          targetId: nextNodeInfo.id,
          data: pipelineData,
          meta: nextNodeInfo.meta,
        });
      }
    } else {
      Logger.info(`End of pipeline reached by node ${nodeId}.`);
      // currentNode.reporting.notify();
    }
    const isPersistant =
      (currentNode.config?.chainType ?? 0) & ChainType.PERSISTANT;
    if (!isPersistant) {
      await supervisor.handleRequest({
        id: nodeId,
        signal: NodeSignal.NODE_DELETE,
      });
    } else {
      Logger.warn(`Node ${nodeId} kept for future calls.`);
    }
  }

  getProgress(): number {
    return this.progress;
  }

  canExecute(executedNodes: Set<string>): boolean {
    return this.dependencies.every((dep) => executedNodes.has(dep));
  }

  setDelay(delay: number): void {
    this.delay = delay;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getDataType(): DataType.Type {
    return this.dataType;
  }

  getStatus(): ChainStatus.Type {
    return this.status;
  }

  getDependencies(): string[] {
    return this.dependencies;
  }

  updateStatus(status: ChainStatus.Type, error?: Error): void {
    this.status = status;
    if (status === ChainStatus.NODE_FAILED) {
      this.error = error;
    }
    if (this.reporting) {
      this.reporting.notify(status);
    }
  }
  getError(): Error | undefined {
    return this.error;
  }

  getProcessors(): ProcessorPipeline[] {
    return this.pipelines;
  }

  setNextNodeInfo(id: string, type: NodeType.Type, meta?: PipelineMeta): void {
    this.nextNodeInfo = { id, type, meta };
  }

  getNextNodeInfo(): {
    id: string;
    type: NodeType.Type;
    meta?: PipelineMeta;
  } | null {
    return this.nextNodeInfo;
  }
}
