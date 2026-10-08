import { Redirect, type Href } from 'expo-router';
export default function ApiKeysRedirect() { return <Redirect href={'/settings/access?tab=keys' as Href} />; }
