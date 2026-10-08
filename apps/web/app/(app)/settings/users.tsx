import { Redirect, type Href } from 'expo-router';
export default function UsersRedirect() { return <Redirect href={'/settings/access?tab=users' as Href} />; }
