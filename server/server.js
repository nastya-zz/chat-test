import {createServer, createPubSub} from '@graphql-yoga/node'
import { WebSocketServer } from 'ws'
import { useServer } from 'graphql-ws/lib/use/ws'
import { v4 as uuidv4 } from 'uuid';

const typeDefs = `
    type Message {
        id: ID!
        user: String!
        content: String!
    }

    type Query {
        messages: [Message!]
    }

    type Mutation {
        postMessage(user: String!,  content: String!): ID!
    }
    
    type Subscription {
        messages: [Message!]
    }
`

const messages = []
const pubSub = createPubSub()

const resolvers = {
    Query: {
        messages: () => messages
    },
    Mutation: {
        postMessage: (parent, { user, content }) => {
            const id = uuidv4()
            const message = {
                id,
                user,
                content
            }
            messages.push(message)

            pubSub.publish('postMessage', messages)

            return id
        }
    },
    Subscription: {
        messages: {
            subscribe: () =>  pubSub.subscribe('postMessage'),
            resolve: (payload) => {
                console.log(payload)
                return  payload
            },
        }
    }
}



async function main() {
    const yogaApp = createServer({
        schema: { typeDefs, resolvers },
        graphiql: {
            // Use WebSockets in GraphiQL
            subscriptionsProtocol: 'WS',
        },
    })

    // Get NodeJS Server from Yoga
    const httpServer = await yogaApp.start()
    // Create WebSocket server instance from our Node server
    const wsServer = new WebSocketServer({
        server: httpServer,
        path: yogaApp.getAddressInfo().endpoint,
    })

    // Integrate Yoga's Envelop instance and NodeJS server with graphql-ws
    useServer(
        {
            execute: (args) => args.rootValue.execute(args),
            subscribe: (args) => args.rootValue.subscribe(args),
            onSubscribe: async (ctx, msg) => {
                const { schema, execute, subscribe, contextFactory, parse, validate } =
                    yogaApp.getEnveloped(ctx)

                const args = {
                    schema,
                    operationName: msg.payload.operationName,
                    document: parse(msg.payload.query),
                    variableValues: msg.payload.variables,
                    contextValue: await contextFactory(),
                    rootValue: {
                        execute,
                        subscribe,
                    },
                }

                const errors = validate(args.schema, args.document)
                if (errors.length) return errors
                return args
            },
        },
        wsServer,
    )
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
