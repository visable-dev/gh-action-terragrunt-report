output pet {
  value       = random_pet.pet.id
  sensitive   = false
  description = "Pet"
}

output password {
  value       = random_password.password.id
  sensitive   = true
  description = "Password"
}
