import { createDocumentHandler } from '../lib/meeting-documents.mjs';

export default async request => {
  try {
    const { getStore } = await import('@netlify/blobs');
    const namespace = process.env.CONTEXT === 'production' ? 'production' : (process.env.DEPLOY_ID || 'local');
    return await createDocumentHandler({
      documents: getStore({ name: `dashboard-documents-${namespace}`, consistency: 'strong' }),
      adminKey: process.env.MEETING_ADMIN_KEY
    })(request);
  } catch {
    return new Response(JSON.stringify({ error: '회의 자료 저장소 설정을 확인해주세요.' }), {
      status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
};
