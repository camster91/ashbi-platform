#!/usr/bin/env python3
"""Add deletedAt and draftData fields to Prisma schema models."""

with open('prisma/schema.prisma', 'r') as f:
    lines = f.readlines()

# Models for soft delete
deletedAt_models = {
    "Client", "Project", "Proposal", "Contract", "Invoice",
    "Expense", "Task", "Estimate", "RetainerPlan", "Note",
    "Contact", "TimeEntry", "Attachment", "CalendarEvent",
    "PipelineDeal", "RateCard", "BrandSettings", "Credential",
    "Report", "Template", "Message", "Thread", "ChatMessage",
    "Notification", "InternalNote", "Response", "AssignmentRule",
    "Milestone", "Activity", "TaskComment", "EventAttendee",
    "WeeklyDigest", "OutreachSequence", "OutreachLead",
    "ContentDraft", "LinkedInSequence", "LinkedInProspect",
    "ColdEmailSequence", "ColdEmailProspect", "ColdEmailEvent",
    "AiTeamMessage", "AiContext", "UpworkContract", "UpworkProposal",
    "RevenueSnapshot", "Approval", "ProjectCommunication",
    "ProjectContext", "ClientEmailMapping", "PushSubscription",
    "AshConversation", "AshChatMessage", "ProjectTemplate",
    "IntakeForm", "IntakeFormResponse", "PipelineStage",
    "SurveyResponse", "WPSite", "CreativeBrief", "AdCopy",
    "ContentCalendarEvent", "SEOAudit", "Snippet", "Asset",
    "ClientEmbedding", "TimeSession", "PromptVersion",
    "ClientInvitation", "ApiKey", "Integration", "LineItemTemplate"
}

# Models for autosave draft
draftData_models = {"Proposal", "Invoice", "Contract", "Estimate", "Project", "RetainerPlan"}

new_lines = []
i = 0
added_deleted_at = 0
added_draft = 0
skipped_deleted = 0
skipped_draft = 0

while i < len(lines):
    line = lines[i]
    new_lines.append(line)
    
    # Check if this starts a model definition
    if line.startswith('model ') and '{' in line:
        model_name = line.split('{')[0].strip().split()[1]
        
        # Find the end of this model
        model_start = i
        brace_count = 0
        model_end = i
        for j in range(i, len(lines)):
            l = lines[j]
            brace_count += l.count('{')
            brace_count -= l.count('}')
            if brace_count == 0 and j > i:
                model_end = j
                break
        
        # Check what this model already has
        model_block = lines[i:model_end+1]
        model_text = ''.join(model_block)
        
        has_deleted_at = 'deletedAt' in model_text
        has_draft = 'draftData' in model_text
        
        needs_deleted = model_name in deletedAt_models and not has_deleted_at
        needs_draft = model_name in draftData_models and not has_draft
        
        if needs_deleted or needs_draft:
            # Find insertion point: before the last block (@@map or @@index)
            # Search backwards from model_end to find the right spot
            insert_pos = None
            
            # Look for // Relations
            for k in range(i, model_end):
                if '// Relations' in lines[k]:
                    insert_pos = k
                    break
            
            if insert_pos is None:
                for k in range(i, model_end):
                    if '@@' in lines[k]:
                        insert_pos = k
                        break
            
            if insert_pos is not None:
                # Build the insertions
                insertions = []
                if needs_deleted:
                    insertions.append('  // Soft delete\n')
                    insertions.append('  deletedAt DateTime?\n')
                    insertions.append('\n')
                    added_deleted_at += 1
                if needs_draft:
                    insertions.append('  // Autosave draft\n')
                    insertions.append('  draftData String? // JSON of unsaved form data\n')
                    insertions.append('\n')
                    added_draft += 1
                
                # Replace the model in new_lines
                # Remove already added lines, re-add with insertions
                new_lines = new_lines[:-1]  # Remove the current 'model X {' line
                new_lines.extend(lines[i:insert_pos])
                new_lines.extend(insertions)
                new_lines.extend(lines[insert_pos:model_end+1])
                
                # Skip to after this model
                i = model_end + 1
                continue
        elif has_deleted_at:
            skipped_deleted += 1
        elif has_draft:
            skipped_draft += 1
    
    i += 1

with open('prisma/schema.prisma', 'w') as f:
    f.writelines(new_lines)

print(f"Added deletedAt to {added_deleted_at} models")
print(f"Added draftData to {added_draft} models")
print(f"Already had deletedAt: {skipped_deleted} models")
print(f"Already had draftData: {skipped_draft} models")
print("Schema updated. Run: npx prisma format")
