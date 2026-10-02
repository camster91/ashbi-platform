import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Zap,
  AlertTriangle,
  CheckCircle,
  Copy,
  Send,
  RefreshCw,
  Clock,
  DollarSign,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Mail,
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { Button, Card, LoadingState } from '../components/ui';
import { formatRelativeTime } from '../lib/utils';
import QueryErrorState from '../components/QueryErrorState';

const REMINDER_FAILED = "This reminder couldn't be written. Try again; if it keeps failing, write it yourself from the invoice.";

/**
 * Sort a POST /invoice-chaser/chase answer into written reminders and
 * per-invoice failures (the server reports a failed invoice as
 * `{ invoiceId, error }` and keeps going).
 */
export function splitReminders(reminders = []) {
  const written = {};
  const failed = {};
  for (const reminder of reminders) {
    if (!reminder?.invoiceId) continue;
    if (reminder.error) failed[reminder.invoiceId] = REMINDER_FAILED;
    else written[reminder.invoiceId] = reminder;
  }
  return { written, failed };
}

/** The banner for a run where nothing could be written, or null. */
export function chaseFailureBanner(error, { requested = 0, failed = 0, written = 0 } = {}) {
  if (error) {
    const code = error.data?.code;
    if (typeof code === 'string' && code.startsWith('AI_')) {
      return {
        title: 'AI is unavailable, so no reminders were written',
        message: error.message || "AI isn't set up for this workspace yet. Ask an admin to add an AI provider in Settings.",
      };
    }
    return {
      title: 'Reminders could not be written',
      message: error.message ? `${error.message} Nothing was sent.` : 'Nothing was written or sent. Try again in a minute.',
    };
  }
  if (requested > 1 && written === 0 && failed > 0) {
    return {
      title: 'None of the reminders could be written',
      message: 'AI did not answer for any invoice. Try again in a minute; if it keeps failing, ask an admin to check the AI provider in Settings.',
    };
  }
  return null;
}

function urgencyColor(days) {
  if (days > 30) return 'text-destructive bg-destructive/5';
  if (days > 14) return 'text-warning bg-warning/5';
  return 'text-warning bg-warning/5';
}

function urgencyLabel(days) {
  if (days > 30) return 'Final Notice';
  if (days > 14) return '2nd Reminder';
  return '1st Reminder';
}

export default function InvoiceChaser() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [generatedEmails, setGeneratedEmails] = useState({});
  const [expanded, setExpanded] = useState({});
  const [copied, setCopied] = useState({});
  const [sendingEmail, setSendingEmail] = useState({});
  const [sendSuccess, setSendSuccess] = useState({});
  const [failures, setFailures] = useState({});
  const [banner, setBanner] = useState(null);

  const {
    data: overdueInvoices = [],
    isLoading,
    isError: invoicesError,
    error: invoicesRequestError,
    refetch: refetchInvoices,
    isFetching: invoicesFetching,
  } = useQuery({
    queryKey: ['overdue-invoices'],
    queryFn: () => api.getOverdueInvoices(),
  });

  const chaseMutation = useMutation({
    mutationFn: (data) => api.chaseInvoices(data),
    onMutate: () => setBanner(null),
    onSuccess: (data, variables) => {
      const { written, failed } = splitReminders(data.reminders);
      setGeneratedEmails(prev => ({ ...prev, ...written }));
      setFailures(prev => {
        const next = { ...prev, ...failed };
        for (const invoiceId of Object.keys(written)) delete next[invoiceId];
        return next;
      });
      // Auto-expand all with generated emails
      const expandMap = {};
      for (const invoiceId of Object.keys(written)) expandMap[invoiceId] = true;
      setExpanded(prev => ({ ...prev, ...expandMap }));
      setBanner(chaseFailureBanner(null, {
        requested: variables?.invoiceId ? 1 : (data.reminders || []).length,
        failed: Object.keys(failed).length,
        written: Object.keys(written).length,
      }));
    },
    // The whole run failed (AI unavailable, for example): mark every invoice
    // it covered and say why once, above the list.
    onError: (error, variables) => {
      const failure = chaseFailureBanner(error);
      // "Try again" repeats what failed: one invoice, or the whole run.
      setBanner({ ...failure, retryInvoiceId: variables?.invoiceId || null });
      const ids = variables?.invoiceId ? [variables.invoiceId] : overdueInvoices.map(inv => inv.id).filter(invId => !generatedEmails[invId]);
      setFailures(prev => {
        const next = { ...prev };
        for (const invoiceId of ids) next[invoiceId] = failure.message;
        return next;
      });
    },
  });

  const handleGenerateAll = () => {
    chaseMutation.mutate({});
  };

  const handleGenerateOne = (invoiceId) => {
    chaseMutation.mutate({ invoiceId });
  };

  const handleCopy = (invoiceId) => {
    const email = generatedEmails[invoiceId];
    if (!email) return;
    const text = `Subject: ${email.subject}\n\n${email.body}`;
    navigator.clipboard.writeText(text);
    setCopied(prev => ({ ...prev, [invoiceId]: true }));
    setTimeout(() => setCopied(prev => ({ ...prev, [invoiceId]: false })), 2000);
  };

  const handleSendEmail = async (invoiceId) => {
    const email = generatedEmails[invoiceId];
    const invoice = overdueInvoices.find(inv => inv.id === invoiceId);
    if (!email || !invoice) return;

    setSendingEmail(prev => ({ ...prev, [invoiceId]: true }));
    try {
      await api.sendEmail({
        to: email.contactEmail || '',
        subject: email.subject,
        text: email.body,
        invoiceId,
      });
      setSendSuccess(prev => ({ ...prev, [invoiceId]: true }));
      toast.success('Reminder sent');
    } catch (err) {
      toast.error('Failed to send: ' + err.message);
    } finally {
      setSendingEmail(prev => ({ ...prev, [invoiceId]: false }));
    }
  };

  const pendingInvoiceId = chaseMutation.isPending ? (chaseMutation.variables?.invoiceId || 'all') : null;
  const totalOutstanding = overdueInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid="chaser-header">
        <div className="min-w-0">
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Zap className="w-6 h-6 text-warning" />
            Invoice Chaser
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-powered payment reminders for overdue invoices
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => refetchInvoices()} leftIcon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </Button>
          {overdueInvoices.length > 0 && (
            <Button
              className="min-h-11"
              onClick={handleGenerateAll}
              loading={pendingInvoiceId === 'all'}
              disabled={chaseMutation.isPending}
              leftIcon={<Sparkles className="w-4 h-4" />}
            >
              Generate All Reminders
            </Button>
          )}
        </div>
      </div>

      {/* Summary Banner */}
      {overdueInvoices.length > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 flex items-center gap-4">
          <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-warning">
              {overdueInvoices.length} overdue {overdueInvoices.length === 1 ? 'invoice' : 'invoices'} totaling{' '}
              <span className="font-bold">${totalOutstanding.toLocaleString('en-CA', { minimumFractionDigits: 2 })}</span>
            </p>
          </div>
          <DollarSign className="w-5 h-5 text-warning" />
        </div>
      )}

      {banner && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-destructive">{banner.title}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{banner.message}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            onClick={() => (banner.retryInvoiceId ? handleGenerateOne(banner.retryInvoiceId) : handleGenerateAll())}
            loading={pendingInvoiceId === (banner.retryInvoiceId || 'all')}
            disabled={chaseMutation.isPending}
          >
            Try again
          </Button>
        </div>
      )}

      {/* Invoices */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingState label="Loading overdue invoices…" compact />
        </div>
      ) : invoicesError ? (
        <QueryErrorState
          error={invoicesRequestError}
          message="Overdue invoices could not be loaded"
          onRetry={refetchInvoices}
          isRetrying={invoicesFetching}
        />
      ) : overdueInvoices.length === 0 ? (
        <Card className="p-12 text-center">
          <CheckCircle className="w-12 h-12 text-success mx-auto mb-4" />
          <h3 className="text-lg font-medium">All caught up!</h3>
          <p className="text-sm text-muted-foreground mt-1">No overdue invoices right now.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {overdueInvoices.map((invoice) => {
            const email = generatedEmails[invoice.id];
            const isExpanded = expanded[invoice.id];
            const isGenerating = pendingInvoiceId === 'all' || pendingInvoiceId === invoice.id;
            const failure = !email && failures[invoice.id];

            return (
              <Card key={invoice.id} className="overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link to={`/invoices/${invoice.id}`} className="text-sm font-semibold text-foreground hover:text-primary">
                          {invoice.invoiceNumber}
                        </Link>
                        <span className="text-sm text-muted-foreground">{invoice.client?.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${urgencyColor(invoice.daysOverdue)}`}>
                          {urgencyLabel(invoice.daysOverdue)} · {invoice.daysOverdue}d overdue
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">${invoice.total?.toLocaleString('en-CA', { minimumFractionDigits: 2 })}</span>
                        {invoice.dueDate && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Due {new Date(invoice.dueDate).toLocaleDateString('en-CA')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {email ? (
                        <button
                          onClick={() => setExpanded(prev => ({ ...prev, [invoice.id]: !isExpanded }))}
                          className="flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          {isExpanded ? 'Hide' : 'View Email'}
                        </button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={isGenerating}
                          disabled={chaseMutation.isPending && !isGenerating}
                          onClick={() => handleGenerateOne(invoice.id)}
                          leftIcon={failure ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                          aria-describedby={failure ? `chase-failure-${invoice.id}` : undefined}
                        >
                          {failure ? 'Retry' : 'Generate'}
                        </Button>
                      )}
                    </div>
                  </div>
                  {failure && !isGenerating && (
                    <p id={`chase-failure-${invoice.id}`} role="status" className="mt-2 flex items-start gap-1.5 text-sm text-destructive">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                      {failure}
                    </p>
                  )}
                </div>

                {email && isExpanded && (
                  <div className="border-t border-border p-4 bg-muted/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          {email.urgency || 'Reminder'}
                        </span>
                        {email.contactEmail && (
                          <span className="text-xs text-muted-foreground">→ {email.contactEmail}</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => handleCopy(invoice.id)}
                          leftIcon={<Copy className="w-3 h-3" />}
                        >
                          {copied[invoice.id] ? 'Copied!' : 'Copy'}
                        </Button>
                        {email.contactEmail && !sendSuccess[invoice.id] && (
                          <Button
                            size="xs"
                            loading={sendingEmail[invoice.id]}
                            onClick={() => handleSendEmail(invoice.id)}
                            leftIcon={<Send className="w-3 h-3" />}
                          >
                            Send
                          </Button>
                        )}
                        {sendSuccess[invoice.id] && (
                          <span className="text-xs text-success font-medium flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Sent
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Subject</p>
                      <p className="text-sm text-foreground">{email.subject}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Body</p>
                      <textarea
                        className="w-full text-sm bg-background border border-border rounded-lg p-3 resize-y"
                        rows={8}
                        defaultValue={email.body}
                        onChange={(e) => {
                          setGeneratedEmails(prev => ({
                            ...prev,
                            [invoice.id]: { ...prev[invoice.id], body: e.target.value }
                          }));
                        }}
                      />
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
