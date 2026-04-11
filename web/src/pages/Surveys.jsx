import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Star, TrendingUp, AlertTriangle, Users, BarChart3 } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

export default function Surveys() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('metrics');

  const { data: metrics } = useQuery({
    queryKey: ['nps-metrics'],
    queryFn: () => api.getNpsMetrics(),
  });

  const { data: responses = [], isLoading } = useQuery({
    queryKey: ['survey-responses'],
    queryFn: () => api.getSurveyResponses(),
    enabled: tab === 'responses',
  });

  const { data: atRiskClients = [] } = useQuery({
    queryKey: ['at-risk-clients'],
    queryFn: () => api.getAtRiskClients(),
    enabled: tab === 'at-risk',
  });

  const nps = metrics?.nps ?? 0;
  const promoters = metrics?.promoters ?? 0;
  const passives = metrics?.passives ?? 0;
  const detractors = metrics?.detractors ?? 0;
  const total = promoters + passives + detractors;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
          <Star className="w-6 h-6 text-primary" />
          NPS & Surveys
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Track client satisfaction and identify at-risk accounts</p>
      </div>

      {/* NPS Score */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 text-center">
          <p className="text-xs text-muted-foreground uppercase">NPS Score</p>
          <p className={`text-3xl font-bold mt-1 ${nps >= 50 ? 'text-emerald-500' : nps >= 0 ? 'text-amber-500' : 'text-red-500'}`}>
            {nps}
          </p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-xs text-muted-foreground uppercase">Promoters</p>
          <p className="text-2xl font-bold text-emerald-500 mt-1">{promoters}</p>
          {total > 0 && <p className="text-xs text-muted-foreground">{Math.round(promoters / total * 100)}%</p>}
        </Card>
        <Card className="p-4 text-center">
          <p className="text-xs text-muted-foreground uppercase">Passives</p>
          <p className="text-2xl font-bold text-amber-500 mt-1">{passives}</p>
          {total > 0 && <p className="text-xs text-muted-foreground">{Math.round(passives / total * 100)}%</p>}
        </Card>
        <Card className="p-4 text-center">
          <p className="text-xs text-muted-foreground uppercase">Detractors</p>
          <p className="text-2xl font-bold text-red-500 mt-1">{detractors}</p>
          {total > 0 && <p className="text-xs text-muted-foreground">{Math.round(detractors / total * 100)}%</p>}
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-2">
        {[
          { key: 'metrics', label: 'Responses', icon: BarChart3 },
          { key: 'at-risk', label: 'At-Risk Clients', icon: AlertTriangle },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              tab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Responses */}
      {tab === 'responses' && (
        isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : responses.length === 0 ? (
          <Card className="p-12 text-center">
            <Star className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
            <h3 className="text-lg font-medium">No survey responses yet</h3>
            <p className="text-sm text-muted-foreground mt-1">Responses will appear here when clients submit surveys</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {responses.map(response => (
              <Card key={response.id} className="p-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{response.clientName || response.clientId}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{response.feedback || 'No written feedback'}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-bold ${
                    response.score >= 9 ? 'text-emerald-500' : response.score >= 7 ? 'text-amber-500' : 'text-red-500'
                  }`}>
                    {response.score}/10
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(response.createdAt).toLocaleDateString()}</span>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {/* At-Risk Clients */}
      {tab === 'at-risk' && (
        atRiskClients.length === 0 ? (
          <Card className="p-12 text-center">
            <TrendingUp className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
            <h3 className="text-lg font-medium">No at-risk clients detected</h3>
            <p className="text-sm text-muted-foreground mt-1">Clients with low satisfaction scores will appear here</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {atRiskClients.map(client => (
              <Card key={client.id} className="p-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{client.name}</p>
                  <p className="text-xs text-muted-foreground">Last survey: {client.lastScore}/10</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  (client.lastScore || 0) <= 6 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                  (client.lastScore || 0) <= 8 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                }`}>
                  At Risk
                </span>
              </Card>
            ))}
          </div>
        )
      )}

      {/* Default to responses tab if no tab matches */}
      {tab === 'metrics' && (
        isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : responses.length === 0 ? (
          <Card className="p-12 text-center">
            <Star className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
            <h3 className="text-lg font-medium">No survey responses yet</h3>
            <p className="text-sm text-muted-foreground mt-1">Responses will appear here when clients submit surveys</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {responses.map(response => (
              <Card key={response.id} className="p-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{response.clientName || response.clientId}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{response.feedback || 'No written feedback'}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-bold ${
                    response.score >= 9 ? 'text-emerald-500' : response.score >= 7 ? 'text-amber-500' : 'text-red-500'
                  }`}>
                    {response.score}/10
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(response.createdAt).toLocaleDateString()}</span>
                </div>
              </Card>
            ))}
          </div>
        )
      )}
    </div>
  );
}