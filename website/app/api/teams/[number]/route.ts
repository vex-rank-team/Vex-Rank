import { teamProfileResponse } from '@/lib/team-profile-build';

async function readCache(request:Request){try{return await (globalThis as any).caches?.default?.match(request)}catch{return undefined}}
async function writeCache(request:Request,response:Response){try{await (globalThis as any).caches?.default?.put(request,response.clone())}catch{}}

export async function GET(request: Request, context: { params: Promise<{number:string}> | {number:string} }) {
  const token = process.env.ROBOT_EVENTS_API_TOKEN;
  if (!token) return Response.json({error:'RobotEvents API is not configured.'},{status:503});
  const params = await context.params;
  const number = decodeURIComponent(params.number).trim().toUpperCase();
  if (!/^[0-9]+[A-Z0-9-]*$/.test(number)) return Response.json({error:'Enter a valid team number.'},{status:400});
  const cached=await readCache(request);if(cached)return cached;
  const response=await teamProfileResponse(request,number,token);
  if(response.ok)await writeCache(request,response);
  return response;
}
