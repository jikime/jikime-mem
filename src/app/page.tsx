'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Search, Database, Activity, Clock, MessageSquare, Wrench } from 'lucide-react'

interface Session {
  id: string
  sessionId: string
  projectPath: string
  status: string
  startedAt: string
  endedAt?: string
  _count?: {
    prompts: number
    observations: number
  }
}

interface SearchResult {
  type: string
  data: {
    id: string
    content?: string
    toolName?: string
    timestamp: string
  }
  similarity: number
}

export default function Dashboard() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [stats, setStats] = useState({ sessions: 0, prompts: 0, observations: 0 })

  useEffect(() => {
    fetchSessions()
  }, [])

  const fetchSessions = async () => {
    try {
      const response = await fetch('/api/sessions?limit=10')
      const data = await response.json()
      setSessions(data.sessions || [])

      // 통계 계산
      const totalPrompts = data.sessions?.reduce((sum: number, s: Session) => sum + (s._count?.prompts || 0), 0) || 0
      const totalObservations = data.sessions?.reduce((sum: number, s: Session) => sum + (s._count?.observations || 0), 0) || 0

      setStats({
        sessions: data.sessions?.length || 0,
        prompts: totalPrompts,
        observations: totalObservations
      })
    } catch (error) {
      console.error('Failed to fetch sessions:', error)
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return

    setIsSearching(true)
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, limit: 10 })
      })
      const data = await response.json()
      setSearchResults(data.results || [])
    } catch (error) {
      console.error('Search failed:', error)
    } finally {
      setIsSearching(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="h-6 w-6" />
              <h1 className="text-xl font-bold">jikime-mem</h1>
            </div>
            <Badge variant="outline">v1.0.0</Badge>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Sessions</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.sessions}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Stored Prompts</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.prompts}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Tool Observations</CardTitle>
              <Wrench className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.observations}</div>
            </CardContent>
          </Card>
        </div>

        {/* Search Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Semantic Search
            </CardTitle>
            <CardDescription>
              Search past sessions for relevant work
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                placeholder="Enter search query..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <Button onClick={handleSearch} disabled={isSearching}>
                {isSearching ? 'Searching...' : 'Search'}
              </Button>
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="mt-4 space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">Search Results</h4>
                {searchResults.map((result, index) => (
                  <div key={index} className="p-3 border rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <Badge variant={result.type === 'prompt' ? 'default' : 'secondary'}>
                        {result.type === 'prompt' ? 'Prompt' : 'Tool Use'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Similarity: {Math.round(result.similarity * 100)}%
                      </span>
                    </div>
                    <p className="text-sm line-clamp-2">
                      {result.data.content || result.data.toolName || 'N/A'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(result.data.timestamp)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Sessions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Recent Sessions
            </CardTitle>
            <CardDescription>
              Recent Claude Code sessions
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sessions yet.</p>
            ) : (
              <div className="space-y-3">
                {sessions.map((session) => (
                  <div key={session.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{session.sessionId.substring(0, 8)}...</span>
                        <Badge variant={session.status === 'active' ? 'default' : 'outline'}>
                          {session.status === 'active' ? 'Active' : 'Completed'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {session.projectPath}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-sm">
                        <span className="text-muted-foreground">Prompts:</span> {session._count?.prompts || 0}
                        <span className="mx-2">|</span>
                        <span className="text-muted-foreground">Observations:</span> {session._count?.observations || 0}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(session.startedAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
