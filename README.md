# Data Processing Chain Protocol Library

## Description

The DPCP (Data Processing Chain Protocol) library is a Node.js framework designed to facilitate the orchestration of distributed data processing workflows. It allows users to create and manage a hierarchical system of chains, nodes, and pipelines, enabling scalable and modular integration with external services. The library provides capabilities for monitoring, control, and error management, making it suitable for complex and distributed applications.

## Features

- Hierarchical Structure: Organizes processing workflows into chains, nodes, and pipelines for modularity and scalability.
- Node Lifecycle Management: Manages the creation, execution, and deletion of nodes, ensuring efficient operation.
- Flexible Chain Deployment: Supports dynamic deployment and distribution of chains across local and remote nodes.
- Signal Handling: Provides comprehensive signal management for precise control over node and chain actions.
- Status Monitoring: Utilizes a ReportingAgent for real-time status updates and monitoring of nodes.
- Data Processing: Executes multiple processing pipelines within nodes, allowing for both sequential and parallel execution.
- Integration with External Services: Facilitates communication with external APIs and services, including optional data transformation.
- Centralized Monitoring: The MonitoringAgent aggregates status updates and broadcasts them for external monitoring.
- Error Handling and Logging: Implements a logging system to track operations and manage errors effectively.
- Singleton Patterns: Ensures centralized management for components like NodeSupervisor and MonitoringAgent for consistency.

## How to Build

To build the library, you can use the following command:

```bash
npm run build
```

## How to Run / Install

As this project is a library, it cannot be run independently. To use it, you must install the library in a project.

To install the library, use the following command:

```bash
npm install https://gitpkg.now.sh/Prometheus-X-association/data-processing-chain-protocol/lib?VERSION
```

## Demonstration

To demonstrate how the library works, you can refer to the tests and the test report generated inside the `mochawesome-report` directory after running the following command:

```bash
npm run test
```

To demonstrate the integration of the library, you can follow this setup guide:

1. install the library using
```bash
npm install https://gitpkg.now.sh/Prometheus-X-association/data-processing-chain-protocol/lib?VERSION
```
2. setup the library in your main file
```typescript
import express, { Request, Response, static as expressStatic } from 'express';
import { SupervisorContainer } from './libs/loaders/nodeSupervisor';

export type AppServer = {
    app: express.Application;
    server: Server<typeof IncomingMessage, typeof ServerResponse>;
};

export const startServer = async () => {
    const app = express();
    
    //init supervisor Container from DPCP library
    await SupervisorContainer.getInstance(await getAppKey());
    
    const PORT = port || config.port;

    const server = app.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log('Server running on: http://localhost:' + PORT);
    });

    return { app, server } as AppServer;
};
```
3. implement the library on the needed routes
```typescript
import { SupervisorContainer } from '../../../libs/loaders/nodeSupervisor';
export const useLibrary = async () => {
    // library implementation
    const nodeSupervisor = await SupervisorContainer.getInstance(
        await getAppKey()
    );

    //chain configuration example
    const chainConfig: NodeConfig[] = [
        {
            "services": [],
            "location": "local",
            "monitoringHost": "https://provider.dsp.io/",
            "chainId": ""
        },
        {
            "chainId": "",
            "services": [
                {
                    "targetId": "https://catalog.io/v1/catalog/serviceofferings/66d18b79ee71f9f096baecb7",
                    "meta": {
                        "resolver": "https://infrastructure.dsp.io/",
                        "configuration": {
                            "params": {
                                "custom": "custom"
                            },
                            "infrastructureConfiguration": "671a73867bb2447c8085d96f",
                            "dataExchange": "679126a2a17ed9e96f2ffba7"
                        }
                    }
                }
            ],
            "location": "remote"
        },
        {
            "chainId": "",
            "services": [
                {
                    "targetId": "https://catalog.io/v1/catalog/serviceofferings/66d18b79ee71f9f096baecb1",
                    "meta": {
                        "resolver": "https://consumer.dsp.io/",
                        "configuration": {
                            "params": {
                                "custom": "custom"
                            },
                            "infrastructureConfiguration": "6720a0249cb2e866c196c10f",
                            "dataExchange": "679126a2a17ed9e96f2ffba7"
                        }
                    }
                }
            ],
            "location": "remote"
        }
    ];
    
    //the data that will be exchange through the nodes
    const data = {
        descrption: "data to exchange"
    }

    // create a strat the chain
    await nodeSupervisor.createAndStartChain(chainConfig, data);

    return true;
};
```
4. see the output in the logs, here is some example:
```bash
2025-01-22 17:10:58 info: Resolving host for http://catalog:8082/v1/catalog/serviceofferings/66d18b79ee71f9f096baecb7, meta: {
  "resolver": "http://infrastructure:3002/",
  "configuration": {
    "params": {
      "custom": "custom"
    },
    "infrastructureConfiguration": "671a73867bb2447c8085d96f",
    "dataExchange": "679126a2a17ed9e96f2ffba7"
  }
} -- UNKNOWN LOCATION
2025-01-22:17.10.58 [INFO]: Sending data to next connector on: https://infrastructure.dsp.io/node/communicate/run
2025-01-22:17.10.58 [INFO]: @container:d6a23923f6c699b0ae8a102996c3cd581fb8357a6579be74e4f15ee7035a56a87b05d9ee76954602d0599e3a0ac335a97c2733398ffaa88eadeb07a91cc7d53e: Node 0e9e2626-d542-429b-881a-0a4b09736fbe deleted.
2025-01-22:17.10.58 [INFO]: @container:d6a23923f6c699b0ae8a102996c3cd581fb8357a6579be74e4f15ee7035a56a87b05d9ee76954602d0599e3a0ac335a97c2733398ffaa88eadeb07a91cc7d53e: Chain @supervisor:d6a23923f6c699b0ae8a102996c3cd581fb8357a6579be74e4f15ee7035a56a87b05d9ee76954602d0599e3a0ac335a97c2733398ffaa88eadeb07a91cc7d53e-1737565858347-627bf322 started with root node 0e9e2626-d542-429b-881a-0a4b09736fbe.
2025-01-22:17.10.58 [INFO]: { message: 'reportSignalHandler: Chain setup completed' } 
```

## Contributing

Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## License

This project is licensed under the MIT License.

## Contact

For more information, please contact the project maintainers.
