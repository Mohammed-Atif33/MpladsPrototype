import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { HOME } from '../../lib/nav'
import { EmptyState } from '../../components/ui'

export default function NotFound() {
  const { user } = useAuth()
  return <EmptyState title="Page not found" hint="The page you are looking for does not exist or you do not have access to it."
    action={<Link className="btn-primary" to={HOME[user?.role] || '/'}>Go to my dashboard</Link>} />
}
