import { eventDetailResponse } from '@/lib/event-detail-build';
import { FRESH_FOR_HEADER } from '@/cloudflare/cache-policy';

async function readCache(request:Request){try{return await (globalThis as any).caches?.default?.match(request)}catch{return undefined}}
async function writeCache(request:Request,response:Response){try{await (globalThis as any).caches?.default?.put(request,response.clone())}catch{}}

export async function GET(request:Request, context:{params:Promise<{id:string}>}) {
  const token = process.env.ROBOT_EVENTS_API_TOKEN;
  if (!token) return Response.json({error:'RobotEvents API is not configured.'},{status:503});
  const {id} = await context.params;
  if (!/^\d+$/.test(id)) return Response.json({error:'Invalid event.'},{status:400});
  const cached=await readCache(request);if(cached)return cached;
  const response=await eventDetailResponse(id,token);
  // An event whose results are still arriving is not kept at the edge.
  if(response.ok&&!response.headers.has(FRESH_FOR_HEADER))await writeCache(request,response);
  return response;
}
