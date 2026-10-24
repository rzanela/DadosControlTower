import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  Label,
  Badge,
  Button,
  Skeleton,
  GenieChat,
  useAnalyticsQuery,
  type QueryRegistry,
} from '@databricks/appkit-ui/react';
import {
  AlertTriangle,
  TrendingDown,
  DollarSign,
  ShieldAlert,
  Users,
  Calculator,
  MessageSquare,
  HelpCircle,
  Clock,
  Sparkles,
  ClipboardList,
  CheckCircle2,
  XCircle,
  RefreshCw,
  User,
} from 'lucide-react';

type KpiData = QueryRegistry['kpis']['result'][number];
type ProjetoRisco = QueryRegistry['projetos_risco']['result'][number];
type PessoaOciosa = QueryRegistry['pessoas_ociosas']['result'][number];

interface DecisaoRegistro {
  id: number;
  projeto_origem: string;
  projeto_destino: string;
  recurso_id: string;
  tipo: string;
  decisao: 'aprovada' | 'recusada';
  justificativa: string;
  horas_recuperadas_mes: number;
  economia_mes: number;
  dias_recuperados: number;
  usuario: string;
  criado_em: string;
}

function formatBRL(val: unknown): string {
  const n = Number(val ?? 0);
  if (isNaN(n)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

function formatBRLCompact(val: unknown): string {
  const n = Number(val ?? 0);
  if (isNaN(n)) return 'R$ 0,00';
  if (n >= 1_000_000) {
    return `R$ ${(n / 1_000_000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi`;
  }
  return formatBRL(n);
}

function formatNum(val: unknown, decimals = 2): string {
  const n = Number(val ?? 0);
  if (isNaN(n)) return '0';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatDataHora(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return String(isoString);
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState('projetos');

  // Queries
  const { data: kpiData, loading: kpiLoading, error: kpiError } = useAnalyticsQuery('kpis');
  const { data: projetosData, loading: projetosLoading, error: projetosError } = useAnalyticsQuery('projetos_risco');
  const { data: pessoasData, loading: pessoasLoading, error: pessoasError } = useAnalyticsQuery('pessoas_ociosas');

  const defaultKpis: KpiData = {
    projetos_em_andamento: 0,
    projetos_em_risco: 0,
    projetos_criticos: 0,
    projetos_melancias: 0,
    estouro_previsto: 0,
    carteira: 0,
    alto_risco_30d: 0,
    multa_fornecedores: 0,
  };

  const kpis: KpiData = kpiData && kpiData.length > 0 ? kpiData[0] : defaultKpis;
  const projetos: ProjetoRisco[] = projetosData ?? [];
  const pessoas: PessoaOciosa[] = pessoasData ?? [];

  // Simulator state
  const [selectedColabId, setSelectedColabId] = useState<string>('');
  const [selectedProjetoId, setSelectedProjetoId] = useState<string>('');
  const [onboardingHours, setOnboardingHours] = useState<number>(40);
  const [justificativa, setJustificativa] = useState<string>('');
  const [submittingDecisao, setSubmittingDecisao] = useState<boolean>(false);
  const [feedbackMensagem, setFeedbackMensagem] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  // User identity state
  const [currentUserEmail, setCurrentUserEmail] = useState<string>('usuario.local@vertice.com');

  // Decisões list state
  const [decisoes, setDecisoes] = useState<DecisaoRegistro[]>([]);
  const [decisoesLoading, setDecisoesLoading] = useState<boolean>(false);
  const [decisoesError, setDecisoesError] = useState<string | null>(null);

  // Fetch current user on mount
  useEffect(() => {
    fetch('/api/quem-sou')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Falha ao obter usuário'))))
      .then((data: { email?: string }) => {
        if (data.email) setCurrentUserEmail(data.email);
      })
      .catch(() => {
        // Fallback local
      });
  }, []);

  // Fetch decisões history
  const carregarDecisoes = useCallback(() => {
    setDecisoesLoading(true);
    setDecisoesError(null);
    fetch('/api/decisoes')
      .then((res) => {
        if (!res.ok) throw new Error(`Status HTTP ${res.status}`);
        return res.json();
      })
      .then((data: DecisaoRegistro[]) => {
        setDecisoes(Array.isArray(data) ? data : []);
      })
      .catch((err: Error) => {
        setDecisoesError(err.message || 'Erro ao carregar decisões');
      })
      .finally(() => {
        setDecisoesLoading(false);
      });
  }, []);

  useEffect(() => {
    if (activeTab === 'decisoes') {
      carregarDecisoes();
    }
  }, [activeTab, carregarDecisoes]);

  // Selected entities for simulator
  const selectedPessoa = pessoas.find((p) => p.colaborador_id === selectedColabId) ?? pessoas[0];
  const elegiveisProjetos = projetos.filter(
    (p) => p.situacao === 'crítico' || p.situacao === 'atenção'
  );
  const selectedProjeto = elegiveisProjetos.find((p) => p.projeto_id === selectedProjetoId) ?? elegiveisProjetos[0];

  // Simulator calculations
  const horasParadas = Number(selectedPessoa?.horas_paradas_media_semana ?? 0);
  const custoOciosoSemana = Number(selectedPessoa?.custo_ocioso_medio_semana ?? 0);
  const custoHora = Number(selectedPessoa?.custo_hora ?? 0);
  const horasMes = horasParadas * 4;
  const economiaMes = custoOciosoSemana * 4;

  const isSRE = selectedPessoa?.papel?.toLowerCase().includes('sre') || selectedPessoa?.papel?.toLowerCase().includes('infra');
  const diasImpactoRelevante = isSRE
    ? Number(selectedProjeto?.dias_impacto_falta_sre ?? 0)
    : Number(selectedProjeto?.dias_impacto_rotatividade ?? 0);

  // Proporcionalidade linear: se 90 dias acumularam diasImpactoRelevante, 30 dias de alocação recuperam:
  const diasRecuperadosMes = diasImpactoRelevante > 0 ? (diasImpactoRelevante / 90) * 30 : 0;
  const custoMobilizacao = Number(onboardingHours ?? 0) * custoHora;
  const saldoLiquido = economiaMes - custoMobilizacao;

  // Handle submit decision
  const handleDecisao = async (tipoDecisao: 'aprovada' | 'recusada') => {
    if (!selectedPessoa || !selectedProjeto) return;
    if (justificativa.trim().length < 10) return;

    setSubmittingDecisao(true);
    setFeedbackMensagem(null);

    const payload = {
      projeto_origem: selectedPessoa.projeto_id,
      projeto_destino: selectedProjeto.projeto_id,
      recurso_id: selectedPessoa.colaborador_id,
      tipo: 'pessoa',
      decisao: tipoDecisao,
      justificativa: justificativa.trim(),
      horas_recuperadas_mes: Number(horasMes.toFixed(2)),
      economia_mes: Number(economiaMes.toFixed(2)),
      dias_recuperados: Number(diasRecuperadosMes.toFixed(2)),
    };

    try {
      const res = await fetch('/api/decisoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = (await res.json()) as { error?: string };
        throw new Error(errorData.error || `Erro HTTP ${res.status}`);
      }

      const decisaoCriada = (await res.json()) as DecisaoRegistro;
      setFeedbackMensagem({
        tipo: 'sucesso',
        texto: `Decisão nº ${decisaoCriada.id} ${tipoDecisao} e registrada por ${decisaoCriada.usuario}`,
      });
      setJustificativa('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao registrar decisão';
      setFeedbackMensagem({ tipo: 'erro', texto: msg });
    } finally {
      setSubmittingDecisao(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 text-slate-900">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold shadow-md shadow-blue-500/20">
            PF
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Projeto Farol</h1>
            <p className="text-xs text-slate-500 font-medium">Torre de Controle Operacional, Contratos & Decisões Lakebase</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-slate-100 rounded-lg text-xs font-medium text-slate-700 border border-slate-200">
            <User className="w-3.5 h-3.5 text-blue-600" />
            <span>{currentUserEmail}</span>
          </div>
          <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Lakebase Postgres
          </Badge>
        </div>
      </header>

      {/* Main Tabs Container */}
      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-4 max-w-xl bg-slate-200/80 p-1 rounded-xl">
            <TabsTrigger value="projetos" className="flex items-center gap-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg py-2">
              <ShieldAlert className="w-4 h-4" />
              Projetos em risco
            </TabsTrigger>
            <TabsTrigger value="simulador" className="flex items-center gap-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg py-2">
              <Calculator className="w-4 h-4" />
              Simulador
            </TabsTrigger>
            <TabsTrigger value="decisoes" className="flex items-center gap-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg py-2">
              <ClipboardList className="w-4 h-4" />
              Decisões
            </TabsTrigger>
            <TabsTrigger value="perguntar" className="flex items-center gap-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg py-2">
              <MessageSquare className="w-4 h-4" />
              Perguntar
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: PROJETOS EM RISCO */}
          <TabsContent value="projetos" className="space-y-6 mt-6">
            {kpiError && (
              <div className="p-4 rounded-xl bg-red-50 text-red-700 border border-red-200 text-sm">
                Erro ao carregar KPIs: {kpiError}
              </div>
            )}

            {/* KPI Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Projetos em Risco */}
              <Card className="shadow-sm border-slate-200 hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-xs font-medium uppercase tracking-wider">Projetos em Risco</span>
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                  </div>
                  <CardTitle className="text-3xl font-extrabold text-slate-900 mt-1">
                    {kpiLoading ? <Skeleton className="h-9 w-16" /> : Number(kpis.projetos_em_risco ?? 0)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-[11px] font-semibold">
                      {Number(kpis.projetos_criticos ?? 0)} críticos
                    </Badge>
                    <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 text-[11px] font-semibold">
                      {Number(kpis.projetos_melancias ?? 0)} melancias 🍉
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              {/* Card 2: Estouro Previsto */}
              <Card className="shadow-sm border-slate-200 hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-xs font-medium uppercase tracking-wider">Estouro Previsto</span>
                    <TrendingDown className="w-4 h-4 text-rose-500" />
                  </div>
                  <CardTitle className="text-3xl font-extrabold text-rose-600 mt-1">
                    {kpiLoading ? <Skeleton className="h-9 w-32" /> : formatBRLCompact(kpis.estouro_previsto)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-xs text-slate-500">
                  Exato: {formatBRL(kpis.estouro_previsto)}
                </CardContent>
              </Card>

              {/* Card 3: Carteira Ativa */}
              <Card className="shadow-sm border-slate-200 hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-xs font-medium uppercase tracking-wider">Carteira Ativa</span>
                    <DollarSign className="w-4 h-4 text-emerald-500" />
                  </div>
                  <CardTitle className="text-3xl font-extrabold text-slate-900 mt-1">
                    {kpiLoading ? <Skeleton className="h-9 w-32" /> : formatBRLCompact(kpis.carteira)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-xs text-slate-500">
                  {Number(kpis.projetos_em_andamento ?? 0)} projetos em andamento
                </CardContent>
              </Card>

              {/* Card 4: Multas de Fornecedores */}
              <Card className="shadow-sm border-slate-200 hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between text-slate-500">
                    <span className="text-xs font-medium uppercase tracking-wider">Multas Fornecedor</span>
                    <ShieldAlert className="w-4 h-4 text-blue-500" />
                  </div>
                  <CardTitle className="text-3xl font-extrabold text-blue-700 mt-1">
                    {kpiLoading ? <Skeleton className="h-9 w-32" /> : formatBRL(kpis.multa_fornecedores)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-xs text-slate-500">
                  Calculadas por atraso contratual
                </CardContent>
              </Card>
            </div>

            {/* Projects Table Card */}
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="flex flex-row items-center justify-between pb-4 border-b">
                <div>
                  <CardTitle className="text-lg font-bold text-slate-900">Projetos em Andamento</CardTitle>
                  <CardDescription className="text-xs text-slate-500 mt-0.5">
                    Ordenados por criticidade de prazo (SPI) e estouro financeiro previsto
                  </CardDescription>
                </div>
                <Badge variant="outline" className="bg-slate-100 text-slate-700 text-xs font-medium">
                  {projetos.length} registros
                </Badge>
              </CardHeader>

              <CardContent className="p-0">
                {projetosError && (
                  <div className="p-6 text-sm text-red-600 bg-red-50">
                    Erro ao listar projetos: {projetosError}
                  </div>
                )}

                {projetosLoading ? (
                  <div className="p-6 space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-slate-50/75">
                        <TableRow className="border-b text-[11px] uppercase tracking-wider text-slate-500">
                          <TableHead className="font-semibold py-3 px-4">Projeto</TableHead>
                          <TableHead className="font-semibold py-3 px-3">Cliente</TableHead>
                          <TableHead className="font-semibold py-3 px-3">GP</TableHead>
                          <TableHead className="font-semibold py-3 px-3 text-right">SPI</TableHead>
                          <TableHead className="font-semibold py-3 px-3 text-right">CPI</TableHead>
                          <TableHead className="font-semibold py-3 px-3 text-right">Estouro (R$)</TableHead>
                          <TableHead className="font-semibold py-3 px-3 text-right">Atraso (dias)</TableHead>
                          <TableHead className="font-semibold py-3 px-3 text-center">Situação</TableHead>
                          <TableHead className="font-semibold py-3 px-3 text-center">Melancia</TableHead>
                          <TableHead className="font-semibold py-3 px-3">Causa Principal</TableHead>
                          <TableHead className="font-semibold py-3 px-3 text-right">Multa Atraso</TableHead>
                          <TableHead className="font-semibold py-3 px-4 text-center">P(estouro 30d)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody className="text-xs divide-y divide-slate-100">
                        {projetos.map((p) => {
                          const spi = Number(p.spi ?? 1);
                          const cpi = Number(p.cpi ?? 1);
                          const estouro = Number(p.estouro_previsto ?? 0);
                          const atraso = Number(p.atraso_projetado_dias ?? 0);
                          const multa = Number(p.multa_a_cobrar ?? 0);
                          const isMelancia = p.melancia === true || String(p.melancia) === 'true';

                          return (
                            <TableRow key={p.projeto_id} className="hover:bg-slate-50/70 transition-colors">
                              <TableCell className="font-medium py-3 px-4 text-slate-900 whitespace-nowrap">
                                <div className="font-bold">{p.projeto}</div>
                                <div className="text-[10px] text-slate-400 font-mono">{p.projeto_id}</div>
                              </TableCell>
                              <TableCell className="py-3 px-3 text-slate-700 whitespace-nowrap">{p.cliente}</TableCell>
                              <TableCell className="py-3 px-3 text-slate-600 whitespace-nowrap">{p.gerente_projeto}</TableCell>

                              {/* SPI */}
                              <TableCell className="py-3 px-3 text-right font-mono font-medium whitespace-nowrap">
                                <span className={spi < 0.8 ? 'text-red-600 font-bold' : spi < 1.0 ? 'text-amber-600 font-semibold' : 'text-emerald-600'}>
                                  {formatNum(spi, 2)}
                                </span>
                              </TableCell>

                              {/* CPI */}
                              <TableCell className="py-3 px-3 text-right font-mono font-medium whitespace-nowrap">
                                <span className={cpi < 0.8 ? 'text-red-600 font-bold' : cpi < 1.0 ? 'text-amber-600 font-semibold' : 'text-emerald-600'}>
                                  {formatNum(cpi, 2)}
                                </span>
                              </TableCell>

                              {/* Estouro */}
                              <TableCell className="py-3 px-3 text-right font-mono whitespace-nowrap font-semibold text-rose-600">
                                {formatBRL(estouro)}
                              </TableCell>

                              {/* Atraso */}
                              <TableCell className="py-3 px-3 text-right font-mono whitespace-nowrap">
                                {atraso > 0 ? `+${atraso}d` : `${atraso}d`}
                              </TableCell>

                              {/* Situação */}
                              <TableCell className="py-3 px-3 text-center whitespace-nowrap">
                                {p.situacao === 'crítico' ? (
                                  <Badge className="bg-red-100 text-red-800 hover:bg-red-100 border-none text-[10px] font-bold">
                                    Crítico
                                  </Badge>
                                ) : p.situacao === 'atenção' ? (
                                  <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-none text-[10px] font-bold">
                                    Atenção
                                  </Badge>
                                ) : (
                                  <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none text-[10px] font-medium">
                                    Estável
                                  </Badge>
                                )}
                              </TableCell>

                              {/* Melancia */}
                              <TableCell className="py-3 px-3 text-center whitespace-nowrap">
                                {isMelancia ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                    🍉 Melancia
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </TableCell>

                              {/* Causa Mais Frequente */}
                              <TableCell className="py-3 px-3 text-slate-700 whitespace-nowrap">
                                <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px]">
                                  {p.causa_mais_frequente}
                                </span>
                              </TableCell>

                              {/* Multa Fornecedor */}
                              <TableCell className="py-3 px-3 text-right font-mono whitespace-nowrap">
                                {multa > 0 ? (
                                  <span className="text-blue-700 font-semibold">{formatBRL(multa)}</span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </TableCell>

                              {/* P(estouro 30d) */}
                              <TableCell className="py-3 px-4 text-center whitespace-nowrap font-mono text-slate-400">
                                <span title="Tabela gold.score_estouro_30d pendente de treino">—</span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 2: SIMULADOR & REGISTRO DE DECISÕES */}
          <TabsContent value="simulador" className="space-y-6 mt-6">
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="pb-4 border-b">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <Calculator className="w-5 h-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg font-bold text-slate-900">
                      Simulador de Alocação de Pessoas Ociosas
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500 mt-0.5">
                      Avalie o impacto financeiro e no cronograma ao remanejar talentos subutilizados (&lt; 20% utilização)
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-6 space-y-6">
                {pessoasError && (
                  <div className="p-4 rounded-lg bg-red-50 text-red-700 text-sm">
                    Erro ao listar pessoas ociosas: {pessoasError}
                  </div>
                )}

                {pessoasLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : (
                  <>
                    {/* Simulator Selectors Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* Select Pessoa */}
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-blue-600" />
                          1. Profissional Ocioso (&lt; 20%)
                        </Label>
                        <Select
                          value={selectedColabId || (pessoas[0]?.colaborador_id ?? '')}
                          onValueChange={setSelectedColabId}
                        >
                          <SelectTrigger className="w-full bg-white">
                            <SelectValue placeholder="Selecione um profissional" />
                          </SelectTrigger>
                          <SelectContent>
                            {pessoas.map((p) => (
                              <SelectItem key={p.colaborador_id} value={p.colaborador_id}>
                                {p.nome} ({p.papel} - {p.senioridade}) · {formatNum(p.horas_paradas_media_semana, 1)}h/sem
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {selectedPessoa && (
                          <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border space-y-1">
                            <div><strong>Projeto Origem:</strong> <code className="bg-white px-1 py-0.5 rounded border">{selectedPessoa.projeto_id}</code></div>
                            <div><strong>Custo Hora:</strong> {formatBRL(selectedPessoa.custo_hora)}/h</div>
                            <div><strong>Ociosidade Média:</strong> {formatNum(selectedPessoa.horas_paradas_media_semana, 1)}h/semana ({formatNum(selectedPessoa.utilizacao_media_pct, 1)}% util.)</div>
                            <div><strong>Custo Ocioso:</strong> {formatBRL(selectedPessoa.custo_ocioso_medio_semana)}/semana</div>
                          </div>
                        )}
                      </div>

                      {/* Select Projeto Destino */}
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                          <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                          2. Projeto Destino em Risco
                        </Label>
                        <Select
                          value={selectedProjetoId || (elegiveisProjetos[0]?.projeto_id ?? '')}
                          onValueChange={setSelectedProjetoId}
                        >
                          <SelectTrigger className="w-full bg-white">
                            <SelectValue placeholder="Selecione um projeto em risco" />
                          </SelectTrigger>
                          <SelectContent>
                            {elegiveisProjetos.map((p) => (
                              <SelectItem key={p.projeto_id} value={p.projeto_id}>
                                {p.projeto_id} · {p.projeto} ({p.situacao})
                                {Number(p.dias_impacto_falta_sre ?? 0) > 0 ? ' [Falta SRE]' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {selectedProjeto && (
                          <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border space-y-1">
                            <div><strong>Cliente / GP:</strong> {selectedProjeto.cliente} ({selectedProjeto.gerente_projeto})</div>
                            <div><strong>SPI / Estouro:</strong> {formatNum(selectedProjeto.spi, 2)} · {formatBRL(selectedProjeto.estouro_previsto)}</div>
                            <div><strong>Bloqueio Falta SRE:</strong> {formatNum(selectedProjeto.dias_impacto_falta_sre, 1)} dias acumulados nos últimos 90d</div>
                          </div>
                        )}
                      </div>

                      {/* Parameter: Onboarding Hours */}
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-600" />
                          3. Horas de Onboarding / Mobilização
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          max={160}
                          value={onboardingHours}
                          onChange={(e) => setOnboardingHours(Math.max(0, Number(e.target.value) || 0))}
                          className="bg-white"
                        />
                        <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border space-y-1">
                          <div>Tempo estimado para setup, acessos e ambientação do consultor na nova squad. Padrão: 40h.</div>
                        </div>
                      </div>
                    </div>

                    {/* Simulation Output Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 pt-4 border-t">
                      {/* Horas no Mês */}
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                        <div className="text-[11px] font-semibold text-slate-500 uppercase">Horas no Mês</div>
                        <div className="text-2xl font-bold text-slate-900 mt-1">{formatNum(horasMes, 1)}h</div>
                        <div className="text-[10px] text-slate-400 mt-1">{formatNum(horasParadas, 1)}h/sem × 4 sem</div>
                      </div>

                      {/* Ociosidade Evitada */}
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                        <div className="text-[11px] font-semibold text-slate-500 uppercase">Economia Ociosidade</div>
                        <div className="text-2xl font-bold text-emerald-600 mt-1">{formatBRL(economiaMes)}</div>
                        <div className="text-[10px] text-slate-400 mt-1">Custo ocioso evitado/mês</div>
                      </div>

                      {/* Dias Recuperados */}
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                        <div className="text-[11px] font-semibold text-slate-500 uppercase">Cronograma Recuperado</div>
                        <div className="text-2xl font-bold text-blue-600 mt-1">{formatNum(diasRecuperadosMes, 1)} dias</div>
                        <div className="text-[10px] text-slate-400 mt-1">Desbloqueio projetado/mês</div>
                      </div>

                      {/* Custo Mobilização */}
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                        <div className="text-[11px] font-semibold text-slate-500 uppercase">Custo Mobilização</div>
                        <div className="text-2xl font-bold text-amber-600 mt-1">{formatBRL(custoMobilizacao)}</div>
                        <div className="text-[10px] text-slate-400 mt-1">{onboardingHours}h × {formatBRL(custoHora)}/h</div>
                      </div>

                      {/* Saldo Líquido */}
                      <div className={`rounded-xl p-4 border ${saldoLiquido >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                        <div className="text-[11px] font-semibold uppercase text-slate-600">Saldo Líquido (Mês 1)</div>
                        <div className={`text-2xl font-black mt-1 ${saldoLiquido >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                          {formatBRL(saldoLiquido)}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1">
                          {saldoLiquido >= 0 ? '✓ Retorno positivo imediato' : 'Investimento inicial amortizado em M+2'}
                        </div>
                      </div>
                    </div>

                    {/* ÁREA DE DECISÃO & JUSTIFICATIVA (PROMPT 03) */}
                    <div className="pt-6 border-t space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                            <ClipboardList className="w-4 h-4 text-blue-600" />
                            Registro e Governança de Decisão Operacional
                          </h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Formalize a aprovação ou recusa do remanejamento no Lakebase Postgres
                          </p>
                        </div>
                        <span className="text-[11px] text-slate-500 font-medium">
                          {justificativa.trim().length} / 1000 caracteres (mínimo 10)
                        </span>
                      </div>

                      {/* Feedback message banner */}
                      {feedbackMensagem && (
                        <div
                          className={`p-4 rounded-xl flex items-center gap-2.5 text-xs font-medium border ${
                            feedbackMensagem.tipo === 'sucesso'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-red-50 text-red-800 border-red-200'
                          }`}
                        >
                          {feedbackMensagem.tipo === 'sucesso' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                          )}
                          <span>{feedbackMensagem.texto}</span>
                        </div>
                      )}

                      <div className="space-y-2">
                        <textarea
                          rows={3}
                          value={justificativa}
                          onChange={(e) => setJustificativa(e.target.value)}
                          placeholder="Descreva a justificativa para esta aprovação ou recusa do remanejamento (obrigatório, mínimo de 10 caracteres)..."
                          className="w-full text-xs p-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-slate-900 resize-none shadow-sm placeholder:text-slate-400"
                        />
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <div className="text-[11px] text-slate-500">
                          Operador responsável: <strong>{currentUserEmail}</strong>
                        </div>
                        <div className="flex items-center gap-3">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleDecisao('recusada')}
                            disabled={justificativa.trim().length < 10 || submittingDecisao}
                            className="text-xs font-semibold text-rose-700 border-rose-300 hover:bg-rose-50 hover:text-rose-800 disabled:opacity-40"
                          >
                            <XCircle className="w-4 h-4 mr-1.5" />
                            Recusar Remanejamento
                          </Button>
                          <Button
                            type="button"
                            onClick={() => handleDecisao('aprovada')}
                            disabled={justificativa.trim().length < 10 || submittingDecisao}
                            className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-40"
                          >
                            <CheckCircle2 className="w-4 h-4 mr-1.5" />
                            Aprovar Remanejamento
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Collapsible Details: Explicação e Memória de Cálculo */}
                    <details className="mt-4 p-4 rounded-xl border border-slate-200 bg-slate-50/70 text-xs text-slate-600 group cursor-pointer">
                      <summary className="font-semibold text-slate-800 list-none flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <HelpCircle className="w-4 h-4 text-blue-600" />
                          Memória de Cálculo e Racional da Simulação
                        </span>
                        <span className="text-[11px] text-blue-600 group-open:rotate-180 transition-transform">▼</span>
                      </summary>
                      <div className="mt-3 space-y-2.5 pt-3 border-t text-slate-600 leading-relaxed">
                        <p>
                          <strong>1. Horas Disponíveis no Mês:</strong> Calculadas multiplicando as horas ociosas médias semanais do profissional por 4 semanas padrão:
                          <code className="mx-1 px-1.5 py-0.5 bg-white rounded border font-mono text-[11px]">Horas = horas_paradas_media_semana × 4</code>.
                        </p>
                        <p>
                          <strong>2. Economia de Custo Ocioso:</strong> Valor que a empresa deixará de pagar por horas ociosas sem faturamento:
                          <code className="mx-1 px-1.5 py-0.5 bg-white rounded border font-mono text-[11px]">Economia = custo_ocioso_medio_semana × 4</code>.
                        </p>
                        <p>
                          <strong>3. Dias de Cronograma Recuperados:</strong> Projeção baseada na proporcionalidade linear dos bloqueios registrados nos últimos 90 dias:
                          <code className="mx-1 px-1.5 py-0.5 bg-white rounded border font-mono text-[11px]">Dias Recuperados = (dias_impacto_bloqueio / 90) × 30</code>.
                          {isSRE && ' Como o consultor selecionado é especialista SRE, o cálculo utiliza prioritariamente os dias de impacto por falta de SRE do projeto destino.'}
                        </p>
                        <p>
                          <strong>4. Custo de Mobilização & Saldo Líquido:</strong>
                          <code className="mx-1 px-1.5 py-0.5 bg-white rounded border font-mono text-[11px]">Mobilização = horas_onboarding × custo_hora</code>.
                          O Saldo Líquido do primeiro mês é <code className="mx-1 px-1.5 py-0.5 bg-white rounded border font-mono text-[11px]">Economia - Mobilização</code>. A partir do segundo mês, a economia é líquida total.
                        </p>
                      </div>
                    </details>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3: DECISÕES (HISTÓRICO LAKEBASE - PROMPT 03) */}
          <TabsContent value="decisoes" className="space-y-6 mt-6">
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="flex flex-row items-center justify-between pb-4 border-b">
                <div>
                  <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <ClipboardList className="w-5 h-5 text-blue-600" />
                    Histórico de Decisões Operacionais
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 mt-0.5">
                    Registros auditáveis persistidos no Lakebase Postgres (<code className="font-mono text-[11px]">torre.decisoes</code>)
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={carregarDecisoes}
                    disabled={decisoesLoading}
                    className="text-xs h-8 flex items-center gap-1.5 text-slate-700"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${decisoesLoading ? 'animate-spin' : ''}`} />
                    Atualizar
                  </Button>
                  <Badge variant="outline" className="bg-slate-100 text-slate-700 text-xs font-medium">
                    {decisoes.length} registradas
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {decisoesError && (
                  <div className="p-6 text-sm text-red-600 bg-red-50">
                    Erro ao listar decisões: {decisoesError}
                  </div>
                )}

                {decisoesLoading && decisoes.length === 0 ? (
                  <div className="p-6 space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : decisoes.length === 0 ? (
                  <div className="p-12 text-center text-slate-500 space-y-2">
                    <ClipboardList className="w-10 h-10 mx-auto text-slate-400 stroke-1" />
                    <div className="text-sm font-semibold text-slate-700">Nenhuma decisão registrada até o momento</div>
                    <div className="text-xs text-slate-400 max-w-sm mx-auto">
                      Utilize a aba &ldquo;Simulador&rdquo; para analisar cenários de alocação de talentos ociosos e registrar sua primeira deliberação.
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-slate-50/75">
                        <TableRow className="border-b text-[11px] uppercase tracking-wider text-slate-500">
                          <TableHead className="font-semibold py-3 px-4 w-14">Nº</TableHead>
                          <TableHead className="font-semibold py-3 px-3">Quando</TableHead>
                          <TableHead className="font-semibold py-3 px-3">Pessoa</TableHead>
                          <TableHead className="font-semibold py-3 px-3">Origem → Destino</TableHead>
                          <TableHead className="font-semibold py-3 px-3 text-center">Decisão</TableHead>
                          <TableHead className="font-semibold py-3 px-3">Justificativa</TableHead>
                          <TableHead className="font-semibold py-3 px-3 text-right">Ociosidade Evitada / Mês</TableHead>
                          <TableHead className="font-semibold py-3 px-3 text-right">Dias Recup.</TableHead>
                          <TableHead className="font-semibold py-3 px-4">Por quem</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody className="text-xs divide-y divide-slate-100">
                        {decisoes.map((d) => (
                          <TableRow key={d.id} className="hover:bg-slate-50/70 transition-colors">
                            <TableCell className="font-mono font-bold py-3 px-4 text-slate-900">
                              #{d.id}
                            </TableCell>
                            <TableCell className="py-3 px-3 text-slate-600 whitespace-nowrap">
                              {formatDataHora(d.criado_em)}
                            </TableCell>
                            <TableCell className="py-3 px-3 font-mono font-medium text-slate-900 whitespace-nowrap">
                              {d.recurso_id}
                            </TableCell>
                            <TableCell className="py-3 px-3 font-mono text-slate-700 whitespace-nowrap">
                              <span className="text-slate-500">{d.projeto_origem}</span>
                              <span className="mx-1.5 text-blue-600 font-bold">→</span>
                              <span className="font-bold text-slate-900">{d.projeto_destino}</span>
                            </TableCell>
                            <TableCell className="py-3 px-3 text-center whitespace-nowrap">
                              {d.decisao === 'aprovada' ? (
                                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none text-[11px] font-bold">
                                  Aprovada
                                </Badge>
                              ) : (
                                <Badge className="bg-red-100 text-red-800 hover:bg-red-100 border-none text-[11px] font-bold">
                                  Recusada
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="py-3 px-3 text-slate-700 max-w-xs break-words">
                              {d.justificativa}
                            </TableCell>
                            <TableCell className="py-3 px-3 text-right font-mono font-semibold text-emerald-600 whitespace-nowrap">
                              {formatBRL(d.economia_mes)}
                            </TableCell>
                            <TableCell className="py-3 px-3 text-right font-mono text-blue-700 whitespace-nowrap">
                              +{formatNum(d.dias_recuperados, 1)}d
                            </TableCell>
                            <TableCell className="py-3 px-4 text-slate-600 text-[11px] whitespace-nowrap">
                              {d.usuario}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 4: PERGUNTAR (GENIE) */}
          <TabsContent value="perguntar" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Sidebar with Guidance & Suggested Questions */}
              <div className="lg:col-span-1 space-y-4">
                <Card className="shadow-sm border-slate-200">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-600" />
                      <CardTitle className="text-sm font-bold text-slate-900">Perguntas Sugeridas</CardTitle>
                    </div>
                    <CardDescription className="text-xs text-slate-500">
                      O Genie Agent responde com dados auditados do Lakehouse
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
                      &ldquo;Quais projetos têm comportamento melancia?&rdquo;
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
                      &ldquo;Qual o valor total de multas de fornecedores a cobrar?&rdquo;
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
                      &ldquo;Quais consultores têm mais de 30h de ociosidade por semana?&rdquo;
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
                      &ldquo;Qual o estouro previsto total dos projetos em situação crítica?&rdquo;
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-sm border-slate-200 bg-purple-50/50 border-purple-200">
                  <CardContent className="p-4 space-y-2 text-xs text-purple-900">
                    <div className="font-bold flex items-center gap-1.5 text-purple-800">
                      <span>🎯</span> Farol · Diretoria + Contratos
                    </div>
                    <p className="text-[11px] text-purple-700 leading-relaxed">
                      Este agente foi calibrado e homologado com 100% de acurácia no benchmark dos KPIs de diretoria e contratos.
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Genie Chat Container */}
              <div className="lg:col-span-3">
                <Card className="shadow-sm border-slate-200 overflow-hidden">
                  <CardContent className="p-0">
                    <div className="h-[680px] w-full">
                      <GenieChat alias="default" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
