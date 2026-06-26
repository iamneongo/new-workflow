import { NextRequest, NextResponse } from 'next/server';
import { deleteAutomationSetup } from '@/lib/database';
import { stopListenerForAutomation } from '@/lib/bot-listener';

/**
 * DELETE /api/automations/[id]
 * Deletes the specified automation setup and stops its active listener.
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = 'then' in context.params ? await context.params : context.params;
    const id = resolvedParams.id;

    if (!id) {
      return NextResponse.json({ error: 'Thiếu tham số id' }, { status: 400 });
    }

    // Stop listener if active
    try {
      await stopListenerForAutomation(id);
    } catch (err: any) {
      console.warn(`Error stopping listener during deletion of ${id}:`, err.message);
    }

    // Delete from database
    await deleteAutomationSetup(id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
