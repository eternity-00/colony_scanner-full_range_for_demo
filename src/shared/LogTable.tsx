import type {IoEntry, LogEntry} from '../api/types.ts';
import {fmt} from '../utils/datetime.ts';
import {Badge} from './Badge.tsx';

interface Props {
  logs: LogEntry[] | IoEntry[];
  /** true 면 I/O 패킷 모니터로 그린다. */
  io?: boolean;
}

const isIo = (row: LogEntry | IoEntry): row is IoEntry => 'direction' in row;

export function LogTable({logs, io = false}: Props) {
  return (
    <section className="card log">
      <h3>{io ? 'I/O 패킷 모니터' : '이벤트 로그'}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>시각</th>
              {io && <th>방향</th>}
              <th>종류</th>
              <th>내용</th>
            </tr>
          </thead>
          <tbody>
            {logs.slice(0, 50).map(row => (
              <tr key={row.id}>
                <td>{fmt(row.at)}</td>
                {io && isIo(row) && (
                  <td>
                    <Badge
                      type={row.direction === 'TX' ? 'info' : row.type === 'NACK' ? 'bad' : 'good'}
                    >
                      {row.direction}
                    </Badge>
                  </td>
                )}
                <td>{isIo(row) ? row.type : row.level}</td>
                <td className="payload">{isIo(row) ? JSON.stringify(row.payload) : row.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
