import { createYoga } from "graphql-yoga";
import { schema } from "@/app/lib/graphql/schema";

const yoga = createYoga({
  schema,
  graphqlEndpoint: "/api/graphql",
  maskedErrors: false,
});

export async function GET(request: Request) {
  return yoga.fetch(request);
}

export async function POST(request: Request) {
  return yoga.fetch(request);
}

export async function OPTIONS(request: Request) {
  return yoga.fetch(request);
}
