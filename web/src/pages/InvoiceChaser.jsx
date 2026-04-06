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
import { Button, Card } from '../components/ui';
import { formatRelativeTime } from '../lib/utils';

function urgencyColor(days) {
  if (days > 30) return 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400';
  if (days > 14) return 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400';
  return 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 dark:text-yellow-400';
}

function urgencyLabel(days) {
  if (days > 30) return 'Final Notice';
  if (days > 14) return '2nd Reminder';
  return '1st Reminder';
}

export default function InvoiceChaser() {
  const queryClient = useQueryClient();
  const [generatedEmails, setGeneratedEmails] = useState({});
  const [expanded, setExpanded] = useState({});
  const [copied, setCopied] = useState({});
  const [sendingEmail, setSendingEmail] = useState({});
  const [sendSuccess, setSendSuccess] = useState({});

  const { data: overdueInvoices = [], isLoading, refetch } = useQuery({
    queryKey: ['overdue-invoices'],
    queryFn: () => api.getOverdueInvoices(),
  });

  const chaseMutation = useMutation({
    mutationFn: (data) => api.chaseInvoices(data),
    onSuccess: (data) => {
      const emailMap = {};
      for (const reminder of data.reminders || []) {
        if (!reminder.error) {
          emailMap[reminder.invoiceId] = reminder;
        }
      }
      setGeneratedEmails(prev => ({ ...prev, ...emailMap }));
      // Auto-expand all with generated emails
      const expandMap = {};
      for (const reminder of data.reminders || []) {
        if (!reminder.error) expandMap[reminder.invoiceId] = true;
      }
      setExpanded(prev => ({ ...prev, ...expandMap }));
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
    } catch (err) {
      alert('Failed to send: ' + err.message);
    } finally {
      setSendingEmail(prev => ({ ...prev, [invoiceId]: false }));
    }
  };

  const totalOutstanding = overdueInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-500" />
            Invoice Chaser
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-powered payment reminders for overdue invoices
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} leftIcon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </Button>
          {overdueInvoices.length > 0 && (
            <Button
              onClick={handleGenerateAll}
              loading={chaseMutation.isPending}
              leftIcon={<Sparkles className="w-4 h-4" />}
            >
              Generate All Reminders
            </Button>
          )}
        </div>
      </div>

      {/* Summary Banner */}
      {overdueInvoices.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/10 p-4 flex items-center gap-4">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              {overdueInvoices.length} overdue {overdueInvoices.length === 1 ? 'invoice' : 'invoices'} totaling{' '}
              <span className="font-bold">${totalOutstanding.toLocaleString('en-CA', { minimumFractionDigits: 2 })}</span>
            </p>
          </div>
          <DollarSign className="w-5 h-5 text-amber-600" />
        </div>
      )}

      {/* Invoices */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : overdueInvoices.length === 0 ? (
        <Card className="p-12 text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium">All caught up!</h3>
          <p className="text-sm text-muted-foreground mt-1">No overdue invoices right now.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {overdueInvoices.map((invoice) => {
            const email = generatedEmails[invoice.id];
            const isExpanded = expanded[invoice.id];
            const isGenerating = chaseMutation.isPending;

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
                            Due {new Date(invoice.dueDate).toLocaleDateString()}
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
                          onClick={() => handleGenerateOne(invoice.id)}
                          leftIcon={<Sparkles className="w-3 h-3" />}
                        >
                          Generate
                        </Button>
                      )}
                    </div>
                  </div>
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
                          <span className="text-xs text-green-600 font-medium flex items-center gap-1">
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
