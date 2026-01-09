export function getRequiredProperty(name: string): string {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) {
    throw new Error(`Missing required script property: ${name}`);
  }
  return value;
}
