// Ashbi Platform - Central Type Definitions
// These types bridge the gap between Prisma-generated types and API interfaces.

// ============================================================================
// User & Auth Types
// ============================================================================

export type UserRole = 'ADMIN' | 'MEMBER' | 'CLIENT';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
  isActive: boolean;
  capacity: number;
  hourlyRate?: number;
  skills: string[];
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: AuthenticatedUser;
  token: string;
}

// ============================================================================
// Client & CRM Types
// ============================================================================

export type ClientTier = 'T1' | 'T2' | 'T3';
export type ClientStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type ClientHealthStatus = 'ON_TRACK' | 'AT_RISK' | 'CRITICAL';

export interface ClientFilters {
  status?: ClientStatus;
  tier?: ClientTier;
  health?: ClientHealthStatus;
  search?: string;
}

// ============================================================================
// Project Types
// ============================================================================

export type ProjectStatus = 'STARTING_UP' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';

export interface ProjectFilters {
  status?: ProjectStatus;
  clientId?: string;
  search?: string;
}

// ============================================================================
// Task Types
// ============================================================================

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TaskCategory = 'IMMEDIATE' | 'WAITING_CLIENT' | 'INTERNAL';

export interface TaskFilters {
  projectId?: string;
  assigneeId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  category?: TaskCategory;
}

// ============================================================================
// Finance Types
// ============================================================================

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'PAID' | 'OVERDUE' | 'CANCELLED';
export type ProposalStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'ACCEPTED' | 'REJECTED';
export type ContractStatus = 'DRAFT' | 'SENT' | 'SIGNED' | 'ACTIVE' | 'EXPIRED';

export interface InvoiceFilters {
  status?: InvoiceStatus;
  clientId?: string;
}

// ============================================================================
// AI Types
// ============================================================================

export type AIProvider = 'ollama' | 'claude' | 'gemini';

export interface AIChatRequest {
  message: string;
  context?: string;
  clientId?: string;
  projectId?: string;
  agentRole?: string;
}

export interface AIChatResponse {
  message: string;
  provider: AIProvider;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ============================================================================
// Pipeline Types (from ashbi-hub)
// ============================================================================

export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  color: string;
  probability: number;
}

export interface PipelineDeal {
  id: string;
  title: string;
  value: number;
  clientId: string;
  stageId: string;
  probability: number;
  expectedCloseDate?: string;
  notes?: string;
}

// ============================================================================
// Time Tracking Types (from ashbi-hub)
// ============================================================================

export interface TimeSession {
  id: string;
  userId: string;
  projectId: string;
  taskId?: string;
  startTime: string;
  endTime?: string;
  duration: number; // minutes
  description?: string;
  billable: boolean;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface ApiError {
  error: string;
  code?: string;
  statusCode: number;
}

// ============================================================================
// Semantic Search / Embedding Types (from ashbi-hub)
// ============================================================================

export interface SearchResult {
  id: string;
  clientId: string;
  clientName: string;
  content: string;
  similarity: number;
  source: string;
}

export interface EmbeddingRequest {
  content: string;
  clientId: string;
  source: string;
}

// ============================================================================
// Validation Schemas (Zod)
// ============================================================================

export { z } from 'zod';