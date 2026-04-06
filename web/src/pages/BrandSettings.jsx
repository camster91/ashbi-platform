import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Palette, Upload, Save, Building2, Phone, Mail, Globe, Receipt,
  FileText, ScrollText, Loader2, Check, Image,
} from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';
import { cn } from '../lib/utils';

export default function BrandSettings() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [form, setForm] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: brand, isLoading } = useQuery({
    queryKey: ['brand-settings'],
    queryFn: api.getBrandSettings,
  });

  useEffect(() => {
    if (brand && !form) {
      setForm({ ...brand });
    }
  }, [brand]);

  const saveMutation = useMutation({
    mutationFn: (data) => api.updateBrandSettings(data),
    onSuccess: (data) => {
      queryClient.setQueryData(['brand-settings'], data);
      setForm(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const updated = await api.uploadBrandLogo(file);
      queryClient.setQueryData(['brand-settings'], updated);
      setForm(prev => ({ ...prev, logoUrl: updated.logoUrl }));
    } catch (err) {
      console.error('Logo upload failed:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleSave() {
    if (!form) return;
    const { id, createdAt, updatedAt, ...data } = form;
    saveMutation.mutate(data);
  }

  function update(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  if (isLoading || !form) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const apiBase = import.meta.env.VITE_API_URL?.replace('/api', '') || '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Brand Settings</h1>
          <p className="text-muted-foreground">Customize how your proposals, invoices, and contracts look</p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          leftIcon={saved ? <Check className="w-4 h-4" /> : saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        >
          {saved ? 'Saved!' : 'Save Changes'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: settings */}
        <div className="lg:col-span-2 space-y-6">
          {/* Company Info */}
          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" /> Company Information
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Company Name</label>
                <input
                  value={form.companyName || ''}
                  onChange={e => update('companyName', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Website</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={form.website || ''}
                    onChange={e => update('website', e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="https://ashbi.ca"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="email"
                    value={form.email || ''}
                    onChange={e => update('email', e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="hello@ashbi.ca"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={form.phone || ''}
                    onChange={e => update('phone', e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="+1 (416) 555-0123"
                  />
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1">Address</label>
                <textarea
                  value={form.address || ''}
                  onChange={e => update('address', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="123 Main St, Toronto, ON M5V 1A1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">HST / Tax ID</label>
                <input
                  value={form.taxId || ''}
                  onChange={e => update('taxId', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="123456789 RT0001"
                />
              </div>
            </div>
          </Card>

          {/* Logo */}
          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Image className="w-5 h-5 text-primary" /> Logo
            </h2>
            <div className="flex items-center gap-6">
              <div className="w-32 h-32 rounded-xl border-2 border-dashed border-border flex items-center justify-center bg-muted/30 overflow-hidden">
                {form.logoUrl ? (
                  <img src={`${apiBase}${form.logoUrl}`} alt="Logo" className="w-full h-full object-contain p-2" />
                ) : (
                  <div className="text-center">
                    <Image className="w-8 h-8 text-muted-foreground mx-auto mb-1" />
                    <span className="text-xs text-muted-foreground">No logo</span>
                  </div>
                )}
              </div>
              <div>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  leftIcon={uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                >
                  {uploading ? 'Uploading...' : 'Upload Logo'}
                </Button>
                <p className="text-xs text-muted-foreground mt-2">PNG, JPEG, SVG, or WebP. Max 50MB.</p>
              </div>
            </div>
          </Card>

          {/* Colors */}
          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Palette className="w-5 h-5 text-primary" /> Brand Colors
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Primary Color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.primaryColor || '#c9a84c'}
                    onChange={e => update('primaryColor', e.target.value)}
                    className="w-10 h-10 rounded-lg border border-border cursor-pointer"
                  />
                  <input
                    value={form.primaryColor || ''}
                    onChange={e => update('primaryColor', e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="#c9a84c"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Accent Color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.accentColor || '#1e293b'}
                    onChange={e => update('accentColor', e.target.value)}
                    className="w-10 h-10 rounded-lg border border-border cursor-pointer"
                  />
                  <input
                    value={form.accentColor || ''}
                    onChange={e => update('accentColor', e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="#1e293b"
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Document Footers */}
          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" /> Document Text
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  <Receipt className="w-4 h-4 inline mr-1" /> Invoice Footer
                </label>
                <textarea
                  value={form.invoiceFooter || ''}
                  onChange={e => update('invoiceFooter', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g. Thank you for your business! Payment due within 30 days."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  <FileText className="w-4 h-4 inline mr-1" /> Proposal Footer
                </label>
                <textarea
                  value={form.proposalFooter || ''}
                  onChange={e => update('proposalFooter', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g. This proposal is valid for 30 days from the date of issue."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  <ScrollText className="w-4 h-4 inline mr-1" /> Contract Header
                </label>
                <textarea
                  value={form.contractHeader || ''}
                  onChange={e => update('contractHeader', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g. This agreement is entered into by and between..."
                />
              </div>
            </div>
          </Card>
        </div>

        {/* Right column: preview */}
        <div className="space-y-6">
          <Card className="p-6 sticky top-24">
            <h2 className="text-lg font-semibold text-foreground mb-4">Invoice Header Preview</h2>
            <div
              className="rounded-lg p-6 border"
              style={{ borderColor: form.primaryColor || '#c9a84c', backgroundColor: `${form.accentColor || '#1e293b'}10` }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  {form.logoUrl ? (
                    <img src={`${apiBase}${form.logoUrl}`} alt="Logo" className="h-10 w-auto mb-2" />
                  ) : (
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center mb-2 text-white font-bold"
                      style={{ backgroundColor: form.primaryColor || '#c9a84c' }}
                    >
                      {(form.companyName || 'A')[0]}
                    </div>
                  )}
                  <h3 className="font-bold text-foreground text-lg">{form.companyName || 'Ashbi Design'}</h3>
                  {form.address && <p className="text-xs text-muted-foreground mt-1 whitespace-pre-line">{form.address}</p>}
                </div>
                <div className="text-right text-xs text-muted-foreground space-y-0.5">
                  {form.email && <p>{form.email}</p>}
                  {form.phone && <p>{form.phone}</p>}
                  {form.website && <p>{form.website}</p>}
                  {form.taxId && <p className="mt-1">HST: {form.taxId}</p>}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t" style={{ borderColor: `${form.primaryColor || '#c9a84c'}40` }}>
                <div className="flex justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">INVOICE</p>
                    <p className="font-bold text-foreground" style={{ color: form.primaryColor || '#c9a84c' }}>INV-2026-0001</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="text-sm text-foreground">April 5, 2026</p>
                  </div>
                </div>
              </div>

              {form.invoiceFooter && (
                <div className="mt-4 pt-3 border-t border-border">
                  <p className="text-xs text-muted-foreground italic">{form.invoiceFooter}</p>
                </div>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <div className="w-6 h-6 rounded" style={{ backgroundColor: form.primaryColor || '#c9a84c' }} title="Primary" />
              <div className="w-6 h-6 rounded" style={{ backgroundColor: form.accentColor || '#1e293b' }} title="Accent" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
