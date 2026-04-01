import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { User, MessageSquare, CheckSquare, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import CreateTeamMemberModal from '../components/CreateTeamMemberModal';

export default function Team() {
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data: team, isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: () => api.getTeam(),
  });

  const { data: workload } = useQuery({
    queryKey: ['team-workload'],
    queryFn: () => api.getWorkload(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Team</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Member
        </button>
      </div>

      <CreateTeamMemberModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />

      {/* Workload Overview */}
      {workload && workload.length > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="font-semibold mb-4">Workload Overview</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {workload.map((member) => (
              <div
                key={member.id}
                className={cn(
                  'p-4 rounded-lg border',
                  member.status === 'overloaded'
                    ? 'bg-red-50 border-red-200'
                    : member.status === 'busy'
                    ? 'bg-yellow-50 border-yellow-200'
                    : 'bg-green-50 border-green-200'
                )}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className={cn(
                      'w-10 h-10 rounded-full flex items-center justify-center font-medium',
                      member.status === 'overloaded'
                        ? 'bg-red-200 text-red-700'
                        : member.status === 'busy'
                        ? 'bg-yellow-200 text-yellow-700'
                        : 'bg-green-200 text-green-700'
                    )}
                  >
                    {member.name[0]}
                  </div>
                  <div>
                    <div className="font-medium">{member.name}</div>
                    <div className="text-sm text-gray-500 capitalize">
                      {member.status}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Utilization</span>
                      <span>{member.utilizationPercent}%</span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          member.status === 'overloaded'
                            ? 'bg-red-500'
                            : member.status === 'busy'
                            ? 'bg-yellow-500'
                            : 'bg-green-500'
                        )}
                        style={{ width: `${Math.min(100, member.utilizationPercent)}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>{member.activeThreads} threads</span>
                    <span>{member.activeTasks} tasks</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team Members Table */}
      <div className="bg-white rounded-lg shadow">
        <table className="w-full">
          <thead>
            <tr className="border-b text-left text-sm text-gray-500">
              <th className="px-4 py-3 font-medium">Member</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Skills</th>
              <th className="px-4 py-3 font-medium">Active Threads</th>
              <th className="px-4 py-3 font-medium">Active Tasks</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {team?.map((member) => (
              <tr key={member.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary/10 text-primary rounded-full flex items-center justify-center font-medium">
                      {member.name[0]}
                    </div>
                    <div>
                      <div className="font-medium">{member.name}</div>
                      <div className="text-sm text-gray-500">{member.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'px-2 py-1 text-xs font-medium rounded',
                      member.role === 'ADMIN'
                        ? 'bg-purple-50 text-purple-700'
                        : 'bg-gray-100 text-gray-700'
                    )}
                  >
                    {member.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {member.skills?.slice(0, 3).map((skill) => (
                      <span
                        key={skill}
                        className="text-xs bg-gray-100 px-2 py-0.5 rounded"
                      >
                        {skill}
                      </span>
                    ))}
                    {member.skills?.length > 3 && (
                      <span className="text-xs text-gray-500">
                        +{member.skills.length - 3} more
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-4 h-4 text-gray-400" />
                    {member.activeThreads || 0}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1">
                    <CheckSquare className="w-4 h-4 text-gray-400" />
                    {member.activeTasks || 0}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'px-2 py-1 text-xs font-medium rounded',
                      member.isActive
                        ? 'bg-green-50 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                    )}
                  >
                    {member.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
