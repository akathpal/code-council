import { routeCodingTask } from "../../../../lib/routing/task-router";

export async function POST(request: Request) {
  const body = await request.json();
  return Response.json(routeCodingTask(body));
}
