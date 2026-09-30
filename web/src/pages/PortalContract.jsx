import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { safeHtml } from '../lib/safeHtml';
import {
  Sparkles,
  CheckCircle,
  FileSignature,
  Loader2,
  Eraser,
  PenTool,
  Keyboard,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatDate } from '../lib/utils';
import LoadingState from '../components/ui/LoadingState';
import usePortalLightTheme from '../hooks/usePortalLightTheme';

function SignatureCanvas({ onSignatureChange }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  const getCoords = useCallback((e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const startDrawing = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { x, y } = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  }, [getCoords]);

  const draw = useCallback((e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { x, y } = getCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  }, [isDrawing, getCoords]);

  const stopDrawing = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false);
      const canvas = canvasRef.current;
      onSignatureChange(hasDrawn ? canvas.toDataURL('image/png') : null);
    }
  }, [isDrawing, hasDrawn, onSignatureChange]);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onSignatureChange(null);
  }, [onSignatureChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  return (
    <div>
      <div className="relative border-2 border-dashed border-border/60 rounded-lg bg-card overflow-hidden">
        <canvas
          ref={canvasRef}
          width={600}
          height={200}
          className="w-full h-40 cursor-crosshair touch-none"
          role="img"
          aria-label="Signature drawing area. Draw with a pointer or choose Type signature for keyboard entry."
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        {!hasDrawn && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-muted-foreground text-sm">Draw your signature here</p>
          </div>
        )}
      </div>
      {hasDrawn && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear drawn signature"
          className="min-h-11 inline-flex items-center mt-2 text-xs text-muted-foreground hover:text-foreground gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Eraser className="w-3 h-3" />
          Clear signature
        </button>
      )}
    </div>
  );
}

export default function PortalContract() {
  usePortalLightTheme();
  const { token } = useParams();
  const [signerName, setSignerName] = useState('');
  const [signatureMode, setSignatureMode] = useState('draw'); // 'draw' | 'type'
  const [signatureData, setSignatureData] = useState(null);
  const [signed, setSigned] = useState(false);
  const [validationError, setValidationError] = useState('');
  const signerRef = useRef(null);

  const { data: contract, isLoading, error } = useQuery({
    queryKey: ['portal-contract', token],
    queryFn: () => api.getPortalContract(token),
    retry: false,
  });

  const signMutation = useMutation({
    mutationFn: (data) => api.signPortalContract(token, data),
    onSuccess: () => {
      setSigned(true);
    },
  });

  const handleSign = () => {
    if (!signerName.trim()) {
      setValidationError('Enter your full legal name.');
      signerRef.current?.focus();
      return;
    }
    if (signatureMode === 'draw' && !signatureData) {
      setValidationError('Draw your signature or choose Type signature.');
      return;
    }
    setValidationError('');
    const payload = {
      signerName: signerName.trim(),
      signatureType: signatureMode,
      agreement: true,
    };
    if (signatureMode === 'draw' && signatureData) {
      payload.signatureImage = signatureData;
    }
    signMutation.mutate(payload);
  };

  if (isLoading) {
    return <LoadingState label="Loading contract…" className="min-h-screen bg-background text-foreground" spinnerClassName="border-border/60 border-t-primary" />;
  }

  if (error || !contract) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <FileSignature className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Contract Not Found</h1>
          <p className="text-muted-foreground">This link may be invalid or expired.</p>
        </div>
      </div>
    );
  }

  const alreadySigned = contract.status === 'SIGNED' || contract.signedAt;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border/40 shadow-sm">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-warning" />
            </div>
            <span className="text-sm font-medium text-muted-foreground">Ashbi Design</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground mt-3">Contract</h1>
          {contract.title && (
            <p className="text-muted-foreground mt-1">{contract.title}</p>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Signed confirmation */}
        {(signed || alreadySigned) && (
          <div className="rounded-xl border border-success/30 bg-success/5 p-6 text-center" role="status" aria-live="polite">
            <CheckCircle className="w-12 h-12 text-success mx-auto mb-3" />
            <h2 className="text-xl font-bold text-success mb-1">Contract Signed</h2>
            <p className="text-success">
              {contract.signedAt
                ? `Signed on ${formatDate(contract.signedAt)}`
                : `Signed on ${formatDate(new Date())}`
              }
            </p>
            {(contract.signerName || signerName) && (
              <p className="text-success text-sm mt-1">
                by {contract.signerName || signerName}
              </p>
            )}
          </div>
        )}

        {/* Contract Content */}
        <div className="bg-card rounded-xl border border-border/40 p-8">
          {contract.clientName && (
            <p className="text-sm text-muted-foreground mb-4">
              Prepared for: <span className="font-medium text-foreground">{contract.clientName}</span>
            </p>
          )}
          <div
            className="prose prose-slate max-w-none prose-headings:font-bold prose-h1:text-2xl prose-h2:text-xl prose-p:text-muted-foreground prose-li:text-muted-foreground"
            dangerouslySetInnerHTML={{
              __html: safeHtml(contract.content || contract.htmlContent || '', { mode: 'strict' }),
            }}
          />
        </div>

        {/* Signature Area */}
        {!signed && !alreadySigned && (
          <div className="bg-card rounded-xl border border-border/40 p-6 space-y-5">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Sign This Contract</h3>

            {/* Name input */}
            <div>
              <label htmlFor="signer-name" className="block text-sm font-medium text-foreground mb-1.5">
                Full Legal Name
              </label>
              <input
                ref={signerRef}
                id="signer-name"
                type="text"
                value={signerName}
                onChange={(e) => { setSignerName(e.target.value); setValidationError(''); }}
                required
                aria-invalid={!!validationError && !signerName.trim()}
                aria-describedby={validationError ? 'signature-validation-error' : undefined}
                placeholder="Enter your full name"
                className="w-full px-4 py-2.5 border border-border/40 rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-warning/20 focus:border-warning"
              />
            </div>

            {/* Signature mode toggle */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Signature</label>
              <div className="flex gap-2 mb-3" role="group" aria-label="Signature method">
                <button
                  type="button"
                  onClick={() => setSignatureMode('draw')}
                  aria-pressed={signatureMode === 'draw'}
                  className={cn(
                    'min-h-11 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    signatureMode === 'draw'
                      ? 'bg-primary text-primary-foreground border-border'
                      : 'bg-card text-muted-foreground border-border/40 hover:bg-muted/50'
                  )}
                >
                  <PenTool className="w-3 h-3" />
                  Draw
                </button>
                <button
                  type="button"
                  onClick={() => setSignatureMode('type')}
                  aria-pressed={signatureMode === 'type'}
                  className={cn(
                    'min-h-11 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    signatureMode === 'type'
                      ? 'bg-primary text-primary-foreground border-border'
                      : 'bg-card text-muted-foreground border-border/40 hover:bg-muted/50'
                  )}
                >
                  <Keyboard className="w-3 h-3" />
                  Type
                </button>
              </div>

              {signatureMode === 'draw' ? (
                <SignatureCanvas onSignatureChange={setSignatureData} />
              ) : (
                <div className="border-2 border-dashed border-border/60 rounded-lg bg-card p-6 text-center" role="status" aria-live="polite" aria-label="Typed signature preview">
                  {signerName.trim() ? (
                    <p className="text-3xl font-signature text-foreground" style={{ fontFamily: "'Caveat', cursive, serif" }}>
                      {signerName}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-sm">Your name will appear here as a typed signature</p>
                  )}
                </div>
              )}
            </div>

            {validationError && <p id="signature-validation-error" role="alert" className="text-sm text-destructive text-center">{validationError}</p>}

            {/* Sign button */}
            <button
              type="button"
              onClick={handleSign}
              disabled={signMutation.isPending}
              aria-busy={signMutation.isPending}
              className="min-h-11 w-full px-6 py-3 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {signMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              <FileSignature className="w-4 h-4" />
              Sign Contract
            </button>

            {signMutation.isError && (
              <p role="alert" className="text-sm text-destructive text-center">Something went wrong. Please try again.</p>
            )}

            <p className="text-xs text-muted-foreground text-center">
              By signing, you agree to the terms outlined in this contract. This constitutes a legally binding electronic signature.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-xs text-muted-foreground">Powered by Ashbi Design</p>
        </div>
      </main>
    </div>
  );
}
