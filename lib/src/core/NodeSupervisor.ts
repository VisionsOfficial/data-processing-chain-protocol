import { Node } from './Node';
import {
  ServiceCallback,
  NodeSignal,
  ChainStatus,
  PipelineData,
  SupervisorPayload,
  CallbackPayload,
  BrodcastSetupMessage,
  ChainConfig,
  ChainRelation,
  NodeConfig,
  NodeType,
  SetupCallback,
  ServiceConfig,
  DefaultCallback,
  ReportingCallback,
  BroadcastReportingCallback,
  ReportingSignalType,
} from '../types/types';
import { Logger } from '../extra/Logger';
import { PipelineProcessor } from './PipelineProcessor';
import { randomUUID } from 'node:crypto';
import { MonitoringAgent } from '../agents/MonitoringAgent';

/**
 * Manages the lifecycle and distribution of nodes within a processing chain
 */
export class NodeSupervisor {
  private uid: string;
  private ctn: string;
  private static instance: NodeSupervisor;
  private nodes: Map<string, Node>;
  private chains: Map<string, ChainRelation>;

  private broadcastSetupCallback: SetupCallback;
  remoteServiceCallback: ServiceCallback;

  /**
   * Creates a new NodeSupervisor instance
   * @private
   */
  private constructor() {
    this.uid = '@supervisor:default';
    this.ctn = '@container:default';
    this.nodes = new Map();
    this.chains = new Map();
    this.remoteServiceCallback = DefaultCallback.SERVICE_CALLBACK;
    this.broadcastSetupCallback = DefaultCallback.SETUP_CALLBACK;
  }

  /**
   * Retrieves or creates a NodeSupervisor instance (Singleton pattern)
   * @param {boolean} refresh - Whether to force create a new instance
   * @returns {NodeSupervisor} The NodeSupervisor instance
   */
  static retrieveService(refresh: boolean = false): NodeSupervisor {
    if (!NodeSupervisor.instance || refresh) {
      const instance = new NodeSupervisor();
      NodeSupervisor.instance = instance;
    }
    return NodeSupervisor.instance;
  }

  /**
   * Sets the remote service callback function
   * @param {ServiceCallback} remoteServiceCallback - The callback to handle remote service calls
   */
  setRemoteServiceCallback(remoteServiceCallback: ServiceCallback): void {
    this.remoteServiceCallback = remoteServiceCallback;
  }

  /**
   * Sets the broadcast setup callback function
   * @param {SetupCallback} broadcastSetupCallback - The callback to handle broadcast setup signals
   */
  setBroadcastSetupCallback(broadcastSetupCallback: SetupCallback): void {
    this.broadcastSetupCallback = broadcastSetupCallback;
  }

  /**
   * Sets the broadcast reporting callback function
   * @param {BroadcastReportingCallback} broadcastReportingCallback - The callback to handle broadcast reporting signals
   */
  setBroadcastReportingCallback(
    broadcastReportingCallback: BroadcastReportingCallback,
  ): void {
    const monitoring = MonitoringAgent.retrieveService();
    monitoring.setBroadcastReportingCallback(broadcastReportingCallback);
  }

  /**
   * Sets the monitoring reporting callback function
   * @param {ReportingCallback} reportingCallback - The callback to handle monitoring reports
   */
  setMonitoringCallback(reportingCallback: ReportingCallback): void {
    const monitoring = MonitoringAgent.retrieveService();
    monitoring.setReportingCallback(reportingCallback);
  }

  /**
   * Sets the unique identifier for this supervisor instance
   * @param {string} uid - The unique identifier
   */
  setUid(uid: string) {
    this.ctn = `@container:${uid}`;
    this.uid = `@supervisor:${uid}`;
  }

  /**
   * Handles supervisor requests (node setup, creation, deletion, etc.)
   * @param {SupervisorPayload} payload - The request payload
   * @returns {Promise<void|string>} Promise resolving to a string if applicable
   */
  async handleRequest(payload: SupervisorPayload): Promise<void | string> {
    switch (payload.signal) {
      case NodeSignal.NODE_SETUP:
        return await this.setupNode(payload.config);
      case NodeSignal.NODE_CREATE:
        return await this.createNode(payload.params);
      case NodeSignal.NODE_DELETE:
        return await this.deleteNode(payload.id);
      case NodeSignal.NODE_PAUSE:
        return await this.pauseNode(payload.id);
      case NodeSignal.NODE_DELAY:
        return await this.delayNode(payload.id, payload.delay);
      case NodeSignal.NODE_RUN:
        return await this.runNode(payload.id, payload.data);
      case NodeSignal.NODE_SEND_DATA:
        return await this.sendNodeData(payload.id);
      case NodeSignal.CHAIN_PREPARE:
        return await this.prepareChainDistribution(payload.id);
      case NodeSignal.CHAIN_START:
        return await this.startChain(payload.id, payload.data);
      case NodeSignal.CHAIN_START_PENDING:
        return await this.startPendingChain(payload.id);
      case NodeSignal.CHAIN_DEPLOY: {
        return await this.deployChain(payload.config, payload.data);
      }
      default:
        Logger.warn(
          `${this.ctn}: Unknown signal received: ${JSON.stringify(payload, null, 2)}`,
        );
    }
  }

  /**
   * Deploys a new processing chain
   * @param {ChainConfig} config - Configuration for the new chain
   * @param {PipelineData} data - Initial data to start the chain
   * @returns {Promise<string>} The new chain identifier
   */
  private async deployChain(
    config: ChainConfig,
    data: PipelineData,
  ): Promise<string> {
    if (!config) {
      throw new Error(`${this.ctn}: Chain configuration is required`);
    }
    Logger.info(`${this.ctn}: Starting a new chain deployment...`);
    const chainId = this.createChain(config);
    await this.prepareChainDistribution(chainId);
    const chain = this.chains.get(chainId);
    if (chain) {
      chain.dataRef = data;
    }
    Logger.info(
      `${this.ctn}: Deployment for chain ${chainId} has successfully started...`,
    );
    return chainId;
  }

  /**
   * Creates a new node with the given configuration
   * @param {NodeConfig} config - The node configuration
   * @returns {Promise<string>} The new node identifier
   */
  private async createNode(config: NodeConfig): Promise<string> {
    const node = new Node();
    const nodeId = node.getId();
    node.setConfig(config);
    this.nodes.set(nodeId, node);
    Logger.info(
      `${this.ctn}: Node ${nodeId} created with config: ${JSON.stringify(config, null, 2)}`,
    );
    return nodeId;
  }

  /**
   * Sets up a new node with the given configuration
   * @param {NodeConfig} config - The node configuration
   * @param {boolean} initiator - Whether the node is the chain initiator
   * @returns {Promise<string>} The new node identifier
   */
  private async setupNode(
    config: NodeConfig,
    initiator: boolean = false,
  ): Promise<string> {
    this.updateChain([config]);
    const nodeId = await this.createNode(config);
    const node = this.nodes.get(nodeId);

    if (!node) {
      Logger.warn(`${this.ctn}: Attempted to setup undefined node`);
      return nodeId;
    }

    await this.setRemoteMonitoringHost(config);

    const processors = config.services.map(
      (service) =>
        new PipelineProcessor(
          typeof service === 'string' ? { targetId: service } : service,
        ),
    );
    await this.addProcessors(nodeId, processors);
    Logger.info(
      `${this.ctn}: Node ${nodeId} setup completed with ${processors.length} processors`,
    );

    if (config.nextTargetId !== undefined) {
      node.setNextNodeInfo(
        config.nextTargetId,
        NodeType.REMOTE,
        config.nextMeta,
      );
    } else if (!initiator) {
      Logger.warn(
        `${this.ctn}: Cannot set next node info: nextTargetId is undefined`,
      );
    }
    this.notify(nodeId, ChainStatus.NODE_SETUP_COMPLETED, 'global-signal');
    return nodeId;
  }

  /**
   * Handles externals notifications about a chain status change
   * @param {string} chainId - The chain identifier
   * @param {ChainStatus.Type} status - The new chain status
   */
  handleNotification(chainId: string, status: ChainStatus.Type): void {
    try {
      const chain = this.chains.get(chainId);
      if (!chain) {
        Logger.warn(`${this.ctn}: Chain with ID ${chainId} not found.`);
        return;
      }
      const rootNodeId = chain.rootNodeId;
      if (!rootNodeId) {
        Logger.warn(`${this.ctn}: Root node ID missing for chain ${chainId}.`);
        return;
      }
      const node = this.nodes.get(rootNodeId);
      if (!node) {
        Logger.warn(`${this.ctn}: Node with ID ${rootNodeId} not found.`);
        return;
      }
      node.notify(status, 'global-signal');
      Logger.info(
        `${this.ctn}: Notification sent to node ${rootNodeId} with status ${status}.`,
      );
    } catch (error) {
      Logger.error(
        `${this.ctn}: Failed to handle notification for chain ${chainId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Notifies a node about a chain status change
   * @param {string} nodeId - The node identifier to notify
   * @param {ChainStatus.Type} status - The new chain status to notify
   */
  private notify(
    nodeId: string,
    status: ChainStatus.Type,
    type: ReportingSignalType = 'local-signal',
  ): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.notify(status, type);
    } else {
      Logger.warn(`${this.ctn}: Can't notify non-existing node ${nodeId}`);
    }
  }

  /**
   * Adds processors to a node
   * @param {string} nodeId - The node identifier
   * @param {PipelineProcessor[]} processors - Array of processors to add
   */
  async addProcessors(
    nodeId: string,
    processors: PipelineProcessor[],
  ): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.addPipeline(processors);
      Logger.info(`${this.ctn}: Processors added to Node ${nodeId}.`);
    } else {
      Logger.warn(`${this.ctn}: Node ${nodeId} not found.`);
    }
  }

  /**
   * Deletes a node
   * @param {string} nodeId - The node identifier to delete
   */
  private async deleteNode(nodeId: string): Promise<void> {
    if (this.nodes.has(nodeId)) {
      this.nodes.delete(nodeId);
      Logger.info(`${this.ctn}: Node ${nodeId} deleted.`);
    } else {
      Logger.warn(`${this.ctn}: Node ${nodeId} not found.`);
    }
  }

  /**
   * Pauses a node
   * @param {string} nodeId - The node identifier to pause
   */
  private async pauseNode(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.updateStatus(ChainStatus.NODE_PAUSED);
      Logger.info(`${this.ctn}: Node ${nodeId} paused.`);
    } else {
      Logger.warn(`${this.ctn}: Node ${nodeId} not found.`);
    }
  }

  /**
   * Delays the execution of a node
   * @param {string} nodeId - The node identifier
   * @param {number} delay - The delay in milliseconds
   */
  private async delayNode(nodeId: string, delay: number): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.setDelay(delay);
      Logger.info(`${this.ctn}: Node ${nodeId} delayed by ${delay} ms.`);
    } else {
      Logger.warn(`${this.ctn}: Node ${nodeId} not found.`);
    }
  }

  /**
   * Creates a new chain with the given configuration
   * @param {ChainConfig} config - The chain configuration
   * @returns {string} The new chain identifier
   */
  createChain(config: ChainConfig): string {
    if (!config || !Array.isArray(config)) {
      throw new Error('Invalid chain configuration: config must be an array');
    }
    const timestamp = Date.now();
    const chainId = `${this.uid}-${timestamp}-${randomUUID().slice(0, 8)}`;
    const relation: ChainRelation = {
      config,
    };

    this.chains.set(chainId, relation);
    const monitoringHost = config[0]?.monitoringHost;
    const count = Array.isArray(config) ? config.length : 0;

    if (count > 0) {
      config.forEach((value: NodeConfig, index: number) => {
        if (value) {
          value.index = index;
          value.count = count;
          value.monitoringHost = monitoringHost;
        }
      });
    } else {
      Logger.warn(`${this.ctn}: Chain configuration is empty`);
    }

    Logger.header(`${this.ctn}: Chain ${chainId} creation has started...`);
    return chainId;
  }

  /**
   * Updates an existing chain with new configurations
   * @param {ChainConfig} config - The new chain configurations to add
   * @returns {string} The chain identifier
   */
  private updateChain(config: ChainConfig): string {
    if (config.length === 0 || !config[0].chainId) {
      throw new Error('Invalid chain configuration');
    }
    const chainId = config[0].chainId;
    let relation = this.chains.get(chainId);

    if (relation) {
      relation.config = relation.config.concat(config);
      Logger.info(
        `${this.ctn}: Chain ${chainId} updated with ${config.length} new configurations`,
      );
    } else {
      relation = {
        config: config,
      };
      this.chains.set(chainId, relation);
      Logger.info(
        `${this.ctn}: Chain ${chainId} created with ${config.length} configurations`,
      );
    }
    return chainId;
  }

  /**
   * Sets the remote monitoring host for a chain
   * @param {NodeConfig} config - The node configuration containing the monitoring host
   */
  private async setRemoteMonitoringHost(config: NodeConfig): Promise<void> {
    const remoteMonitoringHost = config.monitoringHost;
    if (!remoteMonitoringHost) {
      throw new Error(
        `${this.ctn}: No Monitoring Host set for Chain ${config.chainId} during distribution`,
      );
    }
    const monitoring = MonitoringAgent.retrieveService();
    monitoring.setRemoteMonitoringHost(config.chainId, remoteMonitoringHost);
  }

  /**
   * Prepares the distribution of a processing chain
   * @param {string} chainId - The chain identifier
   */
  async prepareChainDistribution(chainId: string): Promise<void> {
    Logger.header(
      `${this.ctn}: Chain distribution for ${chainId} in progress...`,
    );
    const chain = this.chains.get(chainId);
    if (!chain) {
      throw new Error(`${this.ctn}: Chain ${chainId} not found`);
    }
    const chainConfig: ChainConfig = chain.config;
    const localConfigs: NodeConfig[] = chainConfig.filter(
      (config) => config.location === 'local',
    );
    const remoteConfigs: NodeConfig[] = chainConfig.filter(
      (config) => config.location === 'remote',
    );

    if (localConfigs.length > 0) {
      const rootNodeId = await this.setupNode(
        { ...localConfigs[0], chainId },
        true,
      );
      chain.rootNodeId = rootNodeId;

      let prevNodeId = rootNodeId;
      for (let i = 1; i < localConfigs.length; i++) {
        const currentNodeId = await this.setupNode(
          {
            ...localConfigs[i],
            chainId,
          },
          true,
        );
        const prevNode = this.nodes.get(prevNodeId);
        if (prevNode) {
          prevNode.setNextNodeInfo(currentNodeId, NodeType.LOCAL);
        }
        prevNodeId = currentNodeId;
      }

      // Set the last local node to point to the first remote service
      if (remoteConfigs.length > 0 && remoteConfigs[0].services.length > 0) {
        const lastLocalNode = this.nodes.get(prevNodeId);
        if (lastLocalNode) {
          const nextService = remoteConfigs[0].services[0];
          lastLocalNode.setNextNodeInfo(
            typeof nextService === 'string'
              ? nextService
              : nextService.targetId,
            NodeType.REMOTE,
            typeof nextService === 'string' ? void 0 : nextService.meta,
          );
        }
      }
    } else {
      Logger.warn(
        `${this.ctn}: No local config found for chain ${chainId}. Root node unavailable.`,
      );
    }

    if (remoteConfigs.length > 0) {
      const updatedRemoteConfigs: NodeConfig[] = remoteConfigs.map(
        (config, index) => {
          const nextConfig: string | ServiceConfig =
            remoteConfigs[index + 1]?.services[0];
          const nodeConfig: NodeConfig = {
            ...config,
            nextTargetId: nextConfig
              ? typeof nextConfig === 'string'
                ? nextConfig
                : nextConfig.targetId
              : undefined,
            nextMeta:
              nextConfig && typeof nextConfig !== 'string'
                ? nextConfig.meta
                : undefined,
          };
          return nodeConfig;
        },
      );
      await this.broadcastNodeSetupSignal(chainId, updatedRemoteConfigs);
    }
  }

  /**
   * Broadcasts a setup signal for remote nodes in a chain
   * @param {string} chainId - The chain identifier
   * @param {ChainConfig} remoteConfigs - The remote node configurations
   */
  async broadcastNodeSetupSignal(
    chainId: string,
    remoteConfigs: ChainConfig,
  ): Promise<void> {
    const message: BrodcastSetupMessage = {
      signal: NodeSignal.NODE_SETUP,
      chain: {
        id: chainId,
        config: remoteConfigs,
      },
    };

    try {
      await this.broadcastSetupCallback(message);
      Logger.info(
        `${this.ctn}: Node creation signal broadcasted with chainId: ${chainId} for remote configs`,
      );
    } catch (error) {
      Logger.error(
        `${this.ctn}: Failed to broadcast node creation signal: ${error}`,
      );
    }
  }

  /**
   * Starts a pending chain
   * @param {string} chainId - The chain identifier
   */
  async startPendingChain(chainId: string) {
    const chain = this.chains.get(chainId);
    const data = chain?.dataRef;
    if (data) {
      await this.startChain(chainId, data);
    } else {
      Logger.error(`${this.ctn}: Can't start chain ${chainId}`);
      throw new Error('Something went wrong while starting pending chain');
    }
  }

  /**
   * Starts a new chain
   * @param {string} chainId - The chain identifier
   * @param {PipelineData} data - The initial data to process
   */
  async startChain(chainId: string, data: PipelineData): Promise<void> {
    Logger.header(`Chain ${chainId} requested...`);
    const chain = this.chains.get(chainId);
    if (!chain) {
      Logger.warn(`Chain ${chainId} not found.`);
      return;
    }
    const rootNodeId = chain.rootNodeId;
    if (!rootNodeId) {
      Logger.error(`${this.ctn}: Root node ID for chain ${chainId} not found.`);
      return;
    }

    const rootNode = this.nodes.get(rootNodeId);

    if (!rootNode) {
      Logger.error(
        `${this.ctn}: Root node ${rootNodeId} for chain ${chainId} not found.`,
      );
      return;
    }

    try {
      await this.runNode(rootNodeId, data);
      Logger.info(
        `${this.ctn}: Chain ${chainId} started with root node ${rootNodeId}.`,
      );
    } catch (error) {
      Logger.error(`${this.ctn}: Failed to start chain ${chainId}: ${error}`);
    }
  }

  /**
   * Executes a node with the given data
   * @param {string} nodeId - The node identifier
   * @param {PipelineData} data - The data to process
   */
  private async runNode(nodeId: string, data: PipelineData): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (node) {
      await node.execute(data);
    } else {
      Logger.warn(`${this.ctn}: Node ${nodeId} not found.`);
    }
  }

  /**
   * Executes a node based on the given callback payload
   * @param {CallbackPayload} payload - The payload containing target ID, chain ID, and data
   */
  async runNodeByRelation(payload: CallbackPayload): Promise<void> {
    try {
      const { targetId, chainId, data } = payload;
      Logger.info(`Received data for node hosting target ${targetId}`);
      if (chainId === undefined) {
        throw new Error('chainId is undefined');
      }
      if (targetId === undefined) {
        throw new Error('targetId is undefined');
      }
      const node = this.getNodesByServiceAndChain(targetId, chainId);
      if (!node || node.length === 0) {
        throw new Error(
          `No node found for targetId ${targetId} and chainId ${chainId}`,
        );
      }
      const nodeId = node[0].getId();
      if (nodeId === undefined) {
        throw new Error(
          `No node ID exists for targetId ${targetId} and chainId ${chainId}`,
        );
      }
      await this.handleRequest({
        signal: NodeSignal.NODE_RUN,
        id: nodeId,
        data: data as PipelineData,
      });
    } catch (error) {
      Logger.error(`Error in runNodeByRelation: ${(error as Error).message}`);
    }
  }

  /**
   * Sends data from a node
   * @param {string} nodeId - The node identifier
   */
  private async sendNodeData(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (node) {
      try {
        await node.sendData();
      } catch (err) {
        const error = err as Error;
        Logger.error(
          `${this.ctn}: Node ${nodeId} send data failed: ${error.message}`,
        );
      }
    } else {
      Logger.warn(`${this.ctn}: Node ${nodeId} not found.`);
    }
  }

  /**
   * Gets all the nodes managed by this supervisor
   * @returns {Map<string, Node>} Map of nodes
   */
  getNodes(): Map<string, Node> {
    return this.nodes;
  }

  /**
   * Gets all nodes associated with a specific service and chain
   * @param {string} serviceUid - The service identifier
   * @param {string} chainId - The chain identifier
   * @returns {Node[]} Array of nodes matching the criteria
   */
  getNodesByServiceAndChain(serviceUid: string, chainId: string): Node[] {
    return Array.from(this.nodes.values()).filter((node) => {
      const nodeConfig = node.getConfig();
      if (!nodeConfig) {
        return false;
      }
      return (
        nodeConfig.chainId === chainId &&
        nodeConfig.services.some((service) =>
          typeof service === 'string'
            ? service === serviceUid
            : service.targetId === serviceUid,
        )
      );
    });
  }
}
