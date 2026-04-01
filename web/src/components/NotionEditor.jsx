import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '../lib/utils';
import {
  Type,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Image,
  Plus,
  GripVertical,
  Trash2,
  AtSign
} from 'lucide-react';

const BLOCK_TYPES = {
  paragraph: { label: 'Text', icon: Type },
  heading1: { label: 'Heading 1', icon: Heading1 },
  heading2: { label: 'Heading 2', icon: Heading2 },
  bulletList: { label: 'Bullet List', icon: List },
  numberedList: { label: 'Numbered List', icon: ListOrdered },
  todo: { label: 'To-do', icon: CheckSquare },
  quote: { label: 'Quote', icon: Quote },
  code: { label: 'Code', icon: Code },
  image: { label: 'Image', icon: Image },
};

// Single block component
function Block({ 
  block, 
  index, 
  isFocused, 
  onChange, 
  onFocus, 
  onDelete, 
  onAddBelow, 
  onConvert,
  mentionQuery,
  onMentionSelect,
  mentionResults
}) {
  const contentRef = useRef(null);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [localContent, setLocalContent] = useState(block.content || '');

  useEffect(() => {
    setLocalContent(block.content || '');
  }, [block.content]);

  useEffect(() => {
    if (isFocused && contentRef.current) {
      contentRef.current.focus();
    }
  }, [isFocused]);

  const handleKeyDown = (e) => {
    // Handle @ mention trigger
    if (e.key === '@') {
      setShowMentionMenu(true);
      return;
    }

    // Handle / command
    if (e.key === '/') {
      setShowTypeMenu(true);
      return;
    }

    // Handle backspace on empty block
    if (e.key === 'Backspace' && !localContent) {
      e.preventDefault();
      onDelete(index);
      return;
    }

    // Handle enter to create new block
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onAddBelow(index);
      return;
    }

    // Handle arrow keys for navigation
    if (e.key === 'ArrowUp' && index > 0) {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const blockRect = contentRef.current.getBoundingClientRect();
        if (rect.top <= blockRect.top + 20) {
          e.preventDefault();
          onFocus(index - 1);
        }
      }
    }

    if (e.key === 'ArrowDown') {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const blockRect = contentRef.current.getBoundingClientRect();
        if (rect.bottom >= blockRect.bottom - 20) {
          e.preventDefault();
          onFocus(index + 1);
        }
      }
    }
  };

  const handleInput = (e) => {
    const newContent = e.target.value;
    setLocalContent(newContent);
    onChange(index, { ...block, content: newContent });

    // Check for mention query
    const lastAtIndex = newContent.lastIndexOf('@');
    if (lastAtIndex !== -1 && lastAtIndex === newContent.length - 1) {
      setShowMentionMenu(true);
    }
  };

  const handleTypeSelect = (type) => {
    onConvert(index, type);
    setShowTypeMenu(false);
  };

  const handleMentionSelect = (mention) => {
    const lastAtIndex = localContent.lastIndexOf('@');
    const beforeAt = localContent.substring(0, lastAtIndex);
    const newContent = `${beforeAt}@${mention.type === 'user' ? mention.name : mention.title} `;
    setLocalContent(newContent);
    onChange(index, { 
      ...block, 
      content: newContent,
      mentions: [...(block.mentions || []), mention]
    });
    setShowMentionMenu(false);
    onMentionSelect(mention);
  };

  const renderBlockContent = () => {
    const baseClassName = cn(
      'w-full bg-transparent outline-none placeholder:text-muted-foreground',
      block.type === 'heading1' && 'text-3xl font-heading font-bold',
      block.type === 'heading2' && 'text-2xl font-heading font-semibold',
      block.type === 'quote' && 'border-l-4 border-primary pl-4 italic text-muted-foreground',
      block.type === 'code' && 'font-mono text-sm bg-muted p-4 rounded-lg',
    );

    const placeholder = block.type === 'paragraph' ? "Type '/' for commands" : '';

    switch (block.type) {
      case 'todo':
        return (
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={block.checked || false}
              onChange={(e) => onChange(index, { ...block, checked: e.target.checked })}
              className="w-5 h-5 rounded border-border text-primary focus:ring-primary"
            />
            <input
              ref={contentRef}
              type="text"
              value={localContent}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onFocus={() => onFocus(index)}
              className={cn(baseClassName, block.checked && 'line-through text-muted-foreground')}
              placeholder="To-do"
            />
          </div>
        );

      case 'bulletList':
        return (
          <div className="flex items-start gap-3">
            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-foreground flex-shrink-0" />
            <input
              ref={contentRef}
              type="text"
              value={localContent}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onFocus={() => onFocus(index)}
              className={baseClassName}
              placeholder="List item"
            />
          </div>
        );

      case 'numberedList':
        return (
          <div className="flex items-start gap-3">
            <span className="text-muted-foreground font-medium min-w-[1.5rem]">{index + 1}.</span>
            <input
              ref={contentRef}
              type="text"
              value={localContent}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onFocus={() => onFocus(index)}
              className={baseClassName}
              placeholder="List item"
            />
          </div>
        );

      default:
        return (
          <input
            ref={contentRef}
            type="text"
            value={localContent}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onFocus={() => onFocus(index)}
            className={baseClassName}
            placeholder={placeholder}
          />
        );
    }
  };

  return (
    <div
      className={cn(
        'group relative flex items-start gap-2 py-1',
        'hover:bg-muted/30 rounded-lg transition-colors',
        isFocused && 'bg-muted/50'
      )}
    >
      {/* Drag handle */}
      <div className={cn(
        'opacity-0 group-hover:opacity-100 transition-opacity pt-1',
        isFocused && 'opacity-100'
      )}>
        <GripVertical className="w-5 h-5 text-muted-foreground cursor-grab" />
      </div>

      {/* Block content */}
      <div className="flex-1">
        {renderBlockContent()}
      </div>

      {/* Delete button */}
      <button
        onClick={() => onDelete(index)}
        className={cn(
          'opacity-0 group-hover:opacity-100 transition-opacity p-1',
          'text-muted-foreground hover:text-destructive'
        )}
      >
        <Trash2 className="w-4 h-4" />
      </button>

      {/* Type selector menu */}
      {showTypeMenu && isFocused && (
        <div className="absolute left-8 top-full z-50 mt-1 w-64 bg-card border border-border rounded-xl shadow-xl overflow-hidden animate-scale-in">
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase">
            Turn into
          </div>
          {Object.entries(BLOCK_TYPES).map(([type, config]) => (
            <button
              key={type}
              onClick={() => handleTypeSelect(type)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 text-left',
                'hover:bg-muted transition-colors',
                block.type === type && 'bg-primary/10 text-primary'
              )}
            >
              <config.icon className="w-4 h-4" />
              <span className="text-sm">{config.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Mention menu */}
      {showMentionMenu && isFocused && mentionResults && (
        <div className="absolute left-8 top-full z-50 mt-1 w-72 bg-card border border-border rounded-xl shadow-xl overflow-hidden animate-scale-in">
          <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase flex items-center gap-1">
            <AtSign className="w-3 h-3" />
            Mention
          </div>
          
          {mentionResults.users?.length > 0 && (
            <>
              <div className="px-3 py-1 text-xs text-muted-foreground">People</div>
              {mentionResults.users.map((user) => (
                <button
                  key={user.id}
                  onClick={() => handleMentionSelect(user)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted transition-colors"
                >
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                    {user.avatar}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{user.name}</div>
                    <div className="text-xs text-muted-foreground">{user.email}</div>
                  </div>
                </button>
              ))}
            </>
          )}
          
          {mentionResults.tasks?.length > 0 && (
            <>
              <div className="px-3 py-1 text-xs text-muted-foreground mt-1">Tasks & Pages</div>
              {mentionResults.tasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => handleMentionSelect(task)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted transition-colors"
                >
                  <span className="text-lg">{task.icon}</span>
                  <div>
                    <div className="text-sm font-medium truncate">{task.title}</div>
                    <div className="text-xs text-muted-foreground">{task.projectName}</div>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Main editor component
export default function NotionEditor({ 
  initialContent = [], 
  onChange, 
  projectId,
  readOnly = false 
}) {
  const [blocks, setBlocks] = useState(initialContent.length > 0 ? initialContent : [
    { type: 'paragraph', content: '' }
  ]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [mentionResults, setMentionResults] = useState({ users: [], tasks: [] });
  const editorRef = useRef(null);

  // Update parent when blocks change
  useEffect(() => {
    onChange?.(blocks);
  }, [blocks, onChange]);

  // Fetch mention results when needed
  const fetchMentions = useCallback(async (query) => {
    if (!query || query.length < 2) {
      setMentionResults({ users: [], tasks: [] });
      return;
    }
    try {
      const { api } = await import('../lib/api');
      const results = await api.searchMentions(query, projectId);
      setMentionResults(results);
    } catch (err) {
      console.error('Failed to fetch mentions:', err);
    }
  }, [projectId]);

  const handleBlockChange = (index, newBlock) => {
    setBlocks(prev => prev.map((b, i) => i === index ? newBlock : b));
  };

  const handleBlockFocus = (index) => {
    setFocusedIndex(index);
  };

  const handleBlockDelete = (index) => {
    if (blocks.length <= 1) return;
    setBlocks(prev => prev.filter((_, i) => i !== index));
    setFocusedIndex(Math.max(0, index - 1));
  };

  const handleAddBelow = (index) => {
    const newBlock = { type: 'paragraph', content: '' };
    setBlocks(prev => [
      ...prev.slice(0, index + 1),
      newBlock,
      ...prev.slice(index + 1)
    ]);
    setFocusedIndex(index + 1);
  };

  const handleBlockConvert = (index, newType) => {
    setBlocks(prev => prev.map((b, i) => 
      i === index ? { ...b, type: newType, checked: newType === 'todo' ? false : undefined } : b
    ));
  };

  const handleAddBlock = () => {
    handleAddBelow(blocks.length - 1);
  };

  if (readOnly) {
    return (
      <div className="space-y-1">
        {blocks.map((block, index) => (
          <div key={index} className="py-1">
            {block.type === 'heading1' && <h1 className="text-3xl font-heading font-bold">{block.content}</h1>}
            {block.type === 'heading2' && <h2 className="text-2xl font-heading font-semibold">{block.content}</h2>}
            {block.type === 'paragraph' && <p>{block.content}</p>}
            {block.type === 'bulletList' && <li className="ml-4">{block.content}</li>}
            {block.type === 'quote' && <blockquote className="border-l-4 border-primary pl-4 italic">{block.content}</blockquote>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={editorRef} className="space-y-0.5">
      {blocks.map((block, index) => (
        <Block
          key={index}
          block={block}
          index={index}
          isFocused={focusedIndex === index}
          onChange={handleBlockChange}
          onFocus={handleBlockFocus}
          onDelete={handleBlockDelete}
          onAddBelow={handleAddBelow}
          onConvert={handleBlockConvert}
          mentionQuery={null}
          onMentionSelect={() => {}}
          mentionResults={mentionResults}
        />
      ))}
      
      {/* Add block button */}
      <button
        onClick={handleAddBlock}
        className="flex items-center gap-2 px-8 py-2 text-muted-foreground hover:text-foreground transition-colors opacity-0 hover:opacity-100"
      >
        <Plus className="w-4 h-4" />
        <span className="text-sm">Add block</span>
      </button>
    </div>
  );
}
